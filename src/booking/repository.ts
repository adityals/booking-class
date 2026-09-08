import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { withTransaction } from "../infra/db/pool";
import type { Booking, PaymentAttempt } from "../domain/types";

/**
 * Age past which a hold is stale and an in-flight attempt is presumed abandoned.
 * Must exceed the payment client timeout, or a slow-but-live charge gets promoted
 * to `unknown` underneath itself.
 */
function staleAfterSeconds(): number {
  const configured = Number(process.env.HOLD_TTL_SECONDS ?? 30);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}

interface BookingRow extends QueryResultRow {
  id: number;
  student_id: number;
  trial_class_id: number;
  status: Booking["status"];
  amount_cents: number;
  held_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface AttemptRow extends QueryResultRow {
  id: number;
  booking_id: number;
  status: PaymentAttempt["status"];
  amount_cents: number;
  idempotency_key: string;
  provider_ref: string | null;
  error: string | null;
  created_at: Date;
  settled_at: Date | null;
}

function mapBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    studentId: row.student_id,
    trialClassId: row.trial_class_id,
    status: row.status,
    amountCents: row.amount_cents,
    heldAt: row.held_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttempt(row: AttemptRow): PaymentAttempt {
  return {
    id: row.id,
    bookingId: row.booking_id,
    status: row.status,
    amountCents: row.amount_cents,
    idempotencyKey: row.idempotency_key,
    providerRef: row.provider_ref,
    error: row.error,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

export interface PreparedPayment {
  kind: "created" | "existing" | "unavailable" | "settled";
  booking: Booking;
  attempt: PaymentAttempt | null;
}

export class BookingRepository {
  constructor(private readonly pool: Pool) {}
  async createOrGet(studentId: number, trialClassId: number): Promise<Booking> {
    const result = await this.pool.query<BookingRow>(
      `INSERT INTO bookings (student_id, trial_class_id, status, amount_cents)
       SELECT $1, id, 'pending_payment', price_cents
       FROM trial_classes
       WHERE id = $2
       ON CONFLICT (student_id, trial_class_id)
       WHERE status IN ('pending_payment', 'seat_held', 'confirmed')
       DO NOTHING
       RETURNING id, student_id, trial_class_id, status, amount_cents, held_at, created_at, updated_at`,
      [studentId, trialClassId],
    );
    if (result.rows.length > 0) {
      return mapBooking(result.rows[0]);
    }
    const existing = await this.pool.query<BookingRow>(
      `SELECT id, student_id, trial_class_id, status, amount_cents, held_at, created_at, updated_at
       FROM bookings
       WHERE student_id = $1 AND trial_class_id = $2
         AND status IN ('pending_payment', 'seat_held', 'confirmed')`,
      [studentId, trialClassId],
    );
    if (existing.rows.length === 0) {
      throw new Error("trial class not found");
    }
    return mapBooking(existing.rows[0]);
  }

  async preparePayment(bookingId: number): Promise<PreparedPayment> {
    return withTransaction(this.pool, async (tx) => {
      const bookingResult = await tx.query<BookingRow>(
        `SELECT id, student_id, trial_class_id, status, amount_cents, held_at, created_at, updated_at
         FROM bookings WHERE id = $1 FOR UPDATE`,
        [bookingId],
      );
      if (bookingResult.rows.length === 0) {
        throw new Error("booking not found");
      }
      const booking = mapBooking(bookingResult.rows[0]);
      // A request that died between committing the attempt and settling it leaves
      // `processing` forever, which the in-flight unique index would turn into a
      // permanent lockout. Age it into `unknown` so the retry replays the same key.
      await tx.query(
        `UPDATE payment_attempts
         SET status = 'unknown', error = COALESCE(error, 'attempt_abandoned')
         WHERE booking_id = $1 AND status = 'processing'
           AND created_at < now() - ($2 * interval '1 second')`,
        [bookingId, staleAfterSeconds()],
      );
      const existingAttempt = await this.findInFlight(tx, bookingId);
      if (
        booking.status === "confirmed" ||
        booking.status === "payment_failed" ||
        booking.status === "seat_unavailable"
      ) {
        return { kind: "settled", booking, attempt: existingAttempt };
      }
      if (existingAttempt) {
        return { kind: "existing", booking, attempt: existingAttempt };
      }
      if (booking.status !== "pending_payment") {
        throw new Error(`booking ${bookingId} is not payable`);
      }

      let claimed = await this.claimSeat(tx, booking.trialClassId);
      if (!claimed) {
        // The class only *appears* full: a hold whose capture never resolved may be
        // squatting a seat. Release those, then give the claim exactly one more go.
        await this.releaseStaleHolds(booking.trialClassId, tx);
        claimed = await this.claimSeat(tx, booking.trialClassId);
      }
      if (!claimed) {
        const unavailable = await tx.query<BookingRow>(
          `UPDATE bookings
           SET status = 'seat_unavailable', updated_at = now()
           WHERE id = $1 AND status = 'pending_payment'
           RETURNING id, student_id, trial_class_id, status, amount_cents, held_at, created_at, updated_at`,
          [bookingId],
        );
        return { kind: "unavailable", booking: mapBooking(unavailable.rows[0]), attempt: null };
      }

      const attemptResult = await tx.query<AttemptRow>(
        `INSERT INTO payment_attempts (booking_id, status, amount_cents, idempotency_key)
         VALUES ($1, 'processing', $2, $3)
         RETURNING id, booking_id, status, amount_cents, idempotency_key, provider_ref, error, created_at, settled_at`,
        [bookingId, booking.amountCents, randomUUID()],
      );
      const heldResult = await tx.query<BookingRow>(
        `UPDATE bookings
         SET status = 'seat_held', held_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'pending_payment'
         RETURNING id, student_id, trial_class_id, status, amount_cents, held_at, created_at, updated_at`,
        [bookingId],
      );
      return {
        kind: "created",
        booking: mapBooking(heldResult.rows[0]),
        attempt: mapAttempt(attemptResult.rows[0]),
      };
    });
  }

  async settleCapture(
    attemptId: number,
    outcome: { status: "succeeded" | "failed" | "unknown"; providerRef?: string; error?: string },
  ): Promise<Booking> {
    return withTransaction(this.pool, async (tx) => {
      const attemptResult = await tx.query<AttemptRow>(
        `UPDATE payment_attempts
         SET status = $2, provider_ref = $3, error = $4,
             settled_at = CASE WHEN $2 = 'unknown' THEN NULL ELSE now() END
         WHERE id = $1
         RETURNING id, booking_id, status, amount_cents, idempotency_key, provider_ref, error, created_at, settled_at`,
        [attemptId, outcome.status, outcome.providerRef ?? null, outcome.error ?? null],
      );
      if (attemptResult.rows.length === 0) {
        throw new Error("payment attempt not found");
      }
      const attempt = attemptResult.rows[0];
      if (outcome.status === "unknown") {
        return this.getBooking(tx, attempt.booking_id);
      }
      if (outcome.status === "succeeded") {
        return this.getBookingAfterUpdate(tx, attempt.booking_id, "confirmed");
      }
      await tx.query(
        `UPDATE trial_classes c
         SET seats_taken = seats_taken - 1
         FROM bookings b
         WHERE b.id = $1 AND c.id = b.trial_class_id AND b.status = 'seat_held'`,
        [attempt.booking_id],
      );
      return this.getBookingAfterUpdate(tx, attempt.booking_id, "payment_failed");
    });
  }

  /**
   * Releases holds whose capture never resolved: `trialClassId` null sweeps every
   * class. A hold with a `processing` or `unknown` attempt is never touched — the
   * charge may have succeeded, and releasing it would leave a Parent paying for
   * nothing. Terminal status is `payment_failed`: the Claim succeeded, so
   * `seat_unavailable` would be a lie, and the Parent may try again.
   */
  async releaseStaleHolds(trialClassId: number | null, executor: Pool | PoolClient = this.pool): Promise<number> {
    const result = await executor.query<{ n: number }>(
      `WITH stale AS (
         SELECT b.id, b.trial_class_id
         FROM bookings b
         WHERE b.status = 'seat_held'
           AND b.held_at < now() - ($1 * interval '1 second')
           AND ($2::bigint IS NULL OR b.trial_class_id = $2::bigint)
           AND NOT EXISTS (
             SELECT 1 FROM payment_attempts a
             WHERE a.booking_id = b.id AND a.status IN ('processing', 'unknown')
           )
         ORDER BY b.id
         FOR UPDATE OF b SKIP LOCKED
       ),
       released AS (
         UPDATE bookings
         SET status = 'payment_failed', updated_at = now()
         WHERE id IN (SELECT id FROM stale)
         RETURNING trial_class_id
       ),
       counted AS (
         SELECT trial_class_id, count(*)::int AS n
         FROM released
         GROUP BY trial_class_id
       )
       UPDATE trial_classes c
       SET seats_taken = c.seats_taken - counted.n
       FROM counted
       WHERE c.id = counted.trial_class_id
       RETURNING counted.n`,
      [staleAfterSeconds(), trialClassId],
    );
    return result.rows.reduce((total, row) => total + Number(row.n), 0);
  }

  /** Holds whose money state is genuinely unknown — only the provider can settle them. */
  async listUnknownAttempts(): Promise<PaymentAttempt[]> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT a.id, a.booking_id, a.status, a.amount_cents, a.idempotency_key,
              a.provider_ref, a.error, a.created_at, a.settled_at
       FROM payment_attempts a
       JOIN bookings b ON b.id = a.booking_id
       WHERE a.status = 'unknown' AND b.status = 'seat_held'
       ORDER BY a.id`,
    );
    return result.rows.map(mapAttempt);
  }

  private async claimSeat(tx: PoolClient, trialClassId: number): Promise<boolean> {
    const claimed = await tx.query(
      `UPDATE trial_classes
       SET seats_taken = seats_taken + 1
       WHERE id = $1 AND seats_taken < capacity
       RETURNING id`,
      [trialClassId],
    );
    return claimed.rows.length > 0;
  }

  private async findInFlight(tx: PoolClient, bookingId: number): Promise<PaymentAttempt | null> {
    const result = await tx.query<AttemptRow>(
      `SELECT id, booking_id, status, amount_cents, idempotency_key, provider_ref, error, created_at, settled_at
       FROM payment_attempts
       WHERE booking_id = $1 AND status IN ('processing', 'unknown')
       ORDER BY id DESC LIMIT 1`,
      [bookingId],
    );
    return result.rows.length === 0 ? null : mapAttempt(result.rows[0]);
  }

  private async getBooking(tx: PoolClient, bookingId: number): Promise<Booking> {
    const result = await tx.query<BookingRow>(
      `SELECT id, student_id, trial_class_id, status, amount_cents, held_at, created_at, updated_at
       FROM bookings WHERE id = $1`,
      [bookingId],
    );
    return mapBooking(result.rows[0]);
  }

  private async getBookingAfterUpdate(
    tx: PoolClient,
    bookingId: number,
    status: "confirmed" | "payment_failed",
  ): Promise<Booking> {
    const result = await tx.query<BookingRow>(
      `UPDATE bookings
       SET status = $2, updated_at = now()
       WHERE id = $1 AND status = 'seat_held'
       RETURNING id, student_id, trial_class_id, status, amount_cents, held_at, created_at, updated_at`,
      [bookingId, status],
    );
    if (result.rows.length > 0) {
      return mapBooking(result.rows[0]);
    }
    return this.getBooking(tx, bookingId);
  }
}
