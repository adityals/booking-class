import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { closePool, getPool } from "../src/infra/db/pool";
import { BookingRepository } from "../src/booking/repository";
import { BookingService } from "../src/booking/service";
import type { CaptureOutcome, PaymentService } from "../src/domain/types";

/**
 * Records every call so a test can assert the loser of a Last-Seat Race reached no
 * provider at all, and replays a memo by Idempotency Key exactly as the real provider
 * does — that replay is what makes retrying an `unknown` attempt safe.
 */
class FakePayments implements PaymentService {
  calls: string[] = [];
  lookups: string[] = [];
  private readonly memo = new Map<string, CaptureOutcome>();

  constructor(private outcome: (key: string) => CaptureOutcome) {}

  async charge(input: { idempotencyKey: string }): Promise<CaptureOutcome> {
    this.calls.push(input.idempotencyKey);
    const replayed = this.memo.get(input.idempotencyKey);
    if (replayed) {
      return replayed;
    }
    const fresh = this.outcome(input.idempotencyKey);
    this.memo.set(input.idempotencyKey, fresh);
    return fresh;
  }

  async lookup(idempotencyKey: string): Promise<CaptureOutcome | null> {
    this.lookups.push(idempotencyKey);
    return this.memo.get(idempotencyKey) ?? null;
  }

  settle(idempotencyKey: string, outcome: CaptureOutcome): void {
    this.memo.set(idempotencyKey, outcome);
  }
}

function succeeds(): CaptureOutcome {
  return { kind: "succeeded", providerRef: randomUUID() };
}

function declines(): CaptureOutcome {
  return { kind: "declined", reason: "payment_declined" };
}

function unknown(): CaptureOutcome {
  return { kind: "unknown", reason: "payment_timeout" };
}

function serviceWith(payments: PaymentService): BookingService {
  return new BookingService(new BookingRepository(getPool()), payments);
}

async function seatConsistency(trialClassId: number): Promise<{ seatsTaken: number; occupying: number }> {
  const result = await getPool().query<{ seats_taken: number; occupying: number }>(
    `SELECT c.seats_taken,
            (SELECT count(*)::int FROM bookings b
             WHERE b.trial_class_id = c.id AND b.status IN ('seat_held', 'confirmed')) AS occupying
     FROM trial_classes c WHERE c.id = $1`,
    [trialClassId],
  );
  return {
    seatsTaken: Number(result.rows[0].seats_taken),
    occupying: Number(result.rows[0].occupying),
  };
}

async function statusOf(bookingId: number): Promise<string> {
  const result = await getPool().query<{ status: string }>(
    "SELECT status FROM bookings WHERE id = $1",
    [bookingId],
  );
  return result.rows[0].status;
}

async function attemptCount(trialClassId: number): Promise<number> {
  const result = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM payment_attempts a JOIN bookings b ON b.id = a.booking_id
     WHERE b.trial_class_id = $1`,
    [trialClassId],
  );
  return Number(result.rows[0].n);
}

const CONTENDERS = 5;

beforeEach(async () => {
  await getPool().query(
    "TRUNCATE payment_attempts, bookings, trial_classes, students, parents RESTART IDENTITY CASCADE",
  );
  const parents = Array.from({ length: CONTENDERS }, (_, index) => `('p${index}', 'Parent ${index}')`);
  const students = Array.from({ length: CONTENDERS }, (_, index) => `(${index + 1}, 'Student ${index}')`);
  await getPool().query(`
    INSERT INTO parents (username, name) VALUES ${parents.join(", ")};
    INSERT INTO students (parent_id, name) VALUES ${students.join(", ")};
    INSERT INTO trial_classes (subject, starts_at, price_cents, capacity) VALUES
      ('One seat', now() + interval '1 day', 2500, 1),
      ('Roomy',    now() + interval '2 days', 2500, 4);
  `);
});

test("last seat confirms exactly one parent and never charges the losers", async () => {
  // A single two-way race passes by luck too often to be a regression test.
  for (let round = 0; round < 10; round += 1) {
    await getPool().query("TRUNCATE payment_attempts, bookings RESTART IDENTITY CASCADE");
    await getPool().query("UPDATE trial_classes SET seats_taken = 0 WHERE id = 1");
    const values = Array.from({ length: CONTENDERS }, (_, index) => `(${index + 1}, 1, 'pending_payment', 2500)`);
    await getPool().query(
      `INSERT INTO bookings (student_id, trial_class_id, status, amount_cents) VALUES ${values.join(", ")}`,
    );

    const payments = new FakePayments(succeeds);
    const service = serviceWith(payments);
    const bookingIds = Array.from({ length: CONTENDERS }, (_, index) => index + 1);
    const results = await Promise.all(bookingIds.map((id) => service.pay(id)));
    const statuses = results.map((booking) => booking.status).sort();

    assert.deepEqual(
      statuses,
      ["confirmed", ...Array.from({ length: CONTENDERS - 1 }, () => "seat_unavailable")].sort(),
      `round ${round}`,
    );
    assert.equal(payments.calls.length, 1, `round ${round}: losers must never reach the provider`);
    assert.equal(await attemptCount(1), 1, `round ${round}: one payment attempt in total`);
    const seats = await seatConsistency(1);
    assert.equal(seats.seatsTaken, 1, `round ${round}`);
    assert.equal(seats.occupying, 1, `round ${round}`);
  }
});

test("identity columns arrive as numbers, not bigint strings", async () => {
  // `pg` returns bigint as a string unless told otherwise, which silently defeats
  // every `Number.isSafeInteger` guard that stands in front of an id.
  const service = serviceWith(new FakePayments(succeeds));
  const booking = await service.createBooking(1, 2);

  assert.equal(typeof booking.id, "number");
  assert.equal(typeof booking.studentId, "number");
  assert.equal(typeof booking.trialClassId, "number");
});

test("concurrent creation converges on one booking", async () => {
  const service = serviceWith(new FakePayments(succeeds));
  const created = await Promise.all([
    service.createBooking(1, 2),
    service.createBooking(1, 2),
    service.createBooking(1, 2),
  ]);
  const ids = new Set(created.map((booking) => booking.id));

  assert.equal(ids.size, 1);
  const rows = await getPool().query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bookings WHERE student_id = 1 AND trial_class_id = 2",
  );
  assert.equal(Number(rows.rows[0].n), 1);
});

test("a decline releases the seat and leaves capacity restored", async () => {
  const payments = new FakePayments(declines);
  const service = serviceWith(payments);
  const booking = await service.createBooking(1, 1);

  const paid = await service.pay(booking.id);

  assert.equal(paid.status, "payment_failed");
  const seats = await seatConsistency(1);
  assert.equal(seats.seatsTaken, 0);
  assert.equal(seats.occupying, 0);
  // The Seat is free, so the Parent may try again on a fresh Booking.
  const retry = await service.createBooking(1, 1);
  assert.notEqual(retry.id, booking.id);
});

test("an unknown outcome keeps the seat and the retry replays instead of charging twice", async () => {
  const payments = new FakePayments(unknown);
  const service = serviceWith(payments);
  const booking = await service.createBooking(1, 1);

  const held = await service.pay(booking.id);
  assert.equal(held.status, "seat_held");
  assert.equal((await seatConsistency(1)).seatsTaken, 1);

  const retried = await service.pay(booking.id);

  assert.equal(retried.status, "seat_held");
  assert.equal(payments.calls.length, 2);
  assert.equal(payments.calls[0], payments.calls[1], "retry must reuse the idempotency key");
  assert.equal(await attemptCount(1), 1, "a retry adds no second attempt");
});

test("an abandoned processing attempt ages into unknown instead of locking the booking out", async () => {
  const payments = new FakePayments(succeeds);
  const service = serviceWith(payments);
  const booking = await service.createBooking(1, 1);
  // Simulate a request that committed the attempt and then died before settling.
  await getPool().query(
    `INSERT INTO payment_attempts (booking_id, status, amount_cents, idempotency_key, created_at)
     VALUES ($1, 'processing', 2500, 'abandoned-key', now() - interval '10 minutes')`,
    [booking.id],
  );
  await getPool().query(
    "UPDATE bookings SET status = 'seat_held', held_at = now() - interval '10 minutes' WHERE id = $1",
    [booking.id],
  );
  await getPool().query("UPDATE trial_classes SET seats_taken = 1 WHERE id = 1");

  const settled = await service.pay(booking.id);

  assert.equal(settled.status, "confirmed");
  assert.deepEqual(payments.calls, ["abandoned-key"], "recovery replays the original key");
});

test("a stale hold is released when a later claim finds the class full", async () => {
  const payments = new FakePayments(succeeds);
  const service = serviceWith(payments);
  // A hold with no attempt at all, older than the TTL: nobody is going to attend.
  await getPool().query(`
    INSERT INTO bookings (student_id, trial_class_id, status, amount_cents, held_at)
    VALUES (1, 1, 'seat_held', 2500, now() - interval '10 minutes');
    UPDATE trial_classes SET seats_taken = 1 WHERE id = 1;
  `);
  const booking = await service.createBooking(2, 1);

  const paid = await service.pay(booking.id);

  assert.equal(paid.status, "confirmed");
  assert.equal(await statusOf(1), "payment_failed", "a released hold is not seat_unavailable");
  const seats = await seatConsistency(1);
  assert.equal(seats.seatsTaken, 1);
  assert.equal(seats.occupying, 1);
});

test("sweep releases stale holds and reconciles unknown attempts against the provider", async () => {
  const payments = new FakePayments(unknown);
  const service = serviceWith(payments);
  const stalled = await service.createBooking(1, 2);
  await service.pay(stalled.id);
  const attempt = await getPool().query<{ idempotency_key: string }>(
    "SELECT idempotency_key FROM payment_attempts WHERE booking_id = $1",
    [stalled.id],
  );
  // The money did move after all; only the provider knows.
  payments.settle(attempt.rows[0].idempotency_key, succeeds());
  await getPool().query(`
    INSERT INTO bookings (student_id, trial_class_id, status, amount_cents, held_at)
    VALUES (2, 2, 'seat_held', 2500, now() - interval '10 minutes');
    UPDATE trial_classes SET seats_taken = 2 WHERE id = 2;
  `);

  const result = await service.sweep();

  assert.deepEqual(result, { released: 1, reconciled: 1 });
  assert.equal(await statusOf(stalled.id), "confirmed");
  const seats = await seatConsistency(2);
  assert.equal(seats.seatsTaken, 1);
  assert.equal(seats.occupying, 1);
});

after(async () => {
  await closePool();
});
