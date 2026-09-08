import type { Pool } from "pg";
import type { BookingStatus, PaymentAttemptStatus } from "../domain/types";

export interface ClassListItem {
  id: number;
  subject: string;
  startsAt: Date;
  priceCents: number;
  capacity: number;
  seatsTaken: number;
  availableSeats: number;
}

export interface RosterBooking {
  id: number;
  studentId: number;
  studentName: string;
  parentId: number;
  parentName: string;
  status: Exclude<BookingStatus, "pending_payment">;
  amountCents: number;
  heldAt: Date | null;
  createdAt: Date;
  attemptStatus: PaymentAttemptStatus | null;
  attemptError: string | null;
  needsReconciliation: boolean;
}

export interface ClassRoster {
  trialClass: ClassListItem;
  confirmed: RosterBooking[];
  operational: RosterBooking[];
  seatsTaken: number;
  rowCount: number;
  seatsTakenMatches: boolean;
}

type ClassRow = {
  id: number | string;
  subject: string;
  starts_at: Date | string;
  price_cents: number | string;
  capacity: number | string;
  seats_taken: number | string;
};

type RosterRow = {
  id: number | string;
  student_id: number | string;
  student_name: string;
  parent_id: number | string;
  parent_name: string;
  status: Exclude<BookingStatus, "pending_payment">;
  amount_cents: number | string;
  held_at: Date | string | null;
  created_at: Date | string;
  attempt_status: PaymentAttemptStatus | null;
  attempt_error: string | null;
};

function toClass(row: ClassRow): ClassListItem {
  const capacity = Number(row.capacity);
  const seatsTaken = Number(row.seats_taken);
  return {
    id: Number(row.id),
    subject: row.subject,
    startsAt: row.starts_at instanceof Date ? row.starts_at : new Date(row.starts_at),
    priceCents: Number(row.price_cents),
    capacity,
    seatsTaken,
    availableSeats: Math.max(0, capacity - seatsTaken),
  };
}

function toRosterBooking(row: RosterRow): RosterBooking {
  return {
    id: Number(row.id),
    studentId: Number(row.student_id),
    studentName: row.student_name,
    parentId: Number(row.parent_id),
    parentName: row.parent_name,
    status: row.status,
    amountCents: Number(row.amount_cents),
    heldAt:
      row.held_at === null
        ? null
        : row.held_at instanceof Date
          ? row.held_at
          : new Date(row.held_at),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    attemptStatus: row.attempt_status,
    attemptError: row.attempt_error,
    needsReconciliation: row.status === "seat_held" && row.attempt_status === "unknown",
  };
}

export class TrialClassReadRepository {
  constructor(private readonly pool: Pool) {}

  async listClasses(): Promise<ClassListItem[]> {
    const result = await this.pool.query<ClassRow>(`
      SELECT id, subject, starts_at, price_cents, capacity, seats_taken
      FROM trial_classes
      ORDER BY starts_at ASC, id ASC
    `);
    return result.rows.map(toClass);
  }

  async getRoster(trialClassId: number): Promise<ClassRoster | null> {
    const classResult = await this.pool.query<ClassRow>(`
      SELECT id, subject, starts_at, price_cents, capacity, seats_taken
      FROM trial_classes
      WHERE id = $1
    `, [trialClassId]);

    const classRow = classResult.rows[0];
    if (!classRow) {
      return null;
    }

    const rosterResult = await this.pool.query<RosterRow>(`
      SELECT b.id, b.student_id, s.name AS student_name, p.id AS parent_id,
             p.name AS parent_name, b.status, b.amount_cents, b.held_at,
             b.created_at, pa.status AS attempt_status, pa.error AS attempt_error
      FROM bookings b
      JOIN students s ON s.id = b.student_id
      JOIN parents p ON p.id = s.parent_id
      LEFT JOIN LATERAL (
        SELECT status, error FROM payment_attempts
        WHERE booking_id = b.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) pa ON true
      WHERE b.trial_class_id = $1
        AND b.status IN ('confirmed', 'seat_held', 'payment_failed', 'seat_unavailable')
      ORDER BY CASE WHEN b.status = 'confirmed' THEN 0 ELSE 1 END,
               b.created_at ASC, b.id ASC
    `, [trialClassId]);

    const consistencyResult = await this.pool.query<{ occupying_count: number | string }>(`
      SELECT COUNT(*)::int AS occupying_count
      FROM bookings
      WHERE trial_class_id = $1 AND status IN ('seat_held', 'confirmed')
    `, [trialClassId]);
    const rowCount = Number(consistencyResult.rows[0]?.occupying_count ?? 0);

    const trialClass = toClass(classRow);
    const bookings = rosterResult.rows.map(toRosterBooking);
    const confirmed = bookings.filter((booking) => booking.status === "confirmed");
    const operational = bookings.filter((booking) => booking.status !== "confirmed");

    return {
      trialClass,
      confirmed,
      operational,
      seatsTaken: trialClass.seatsTaken,
      rowCount,
      seatsTakenMatches: trialClass.seatsTaken === rowCount,
    };
  }
}
