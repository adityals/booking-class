import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { closePool, getPool } from "../src/infra/db/pool";
import { BookingRepository } from "../src/booking/repository";
import { BookingService } from "../src/booking/service";
import type { CaptureOutcome, PaymentService } from "../src/domain/types";

class SuccessfulPayment implements PaymentService {
  calls = 0;

  async charge(): Promise<CaptureOutcome> {
    this.calls += 1;
    return { kind: "succeeded", providerRef: randomUUID() };
  }

  async lookup(): Promise<CaptureOutcome | null> {
    return null;
  }
}

beforeEach(async () => {
  await getPool().query("TRUNCATE payment_attempts, bookings, trial_classes, students, parents RESTART IDENTITY CASCADE");
  await getPool().query(`
    INSERT INTO parents (username, name) VALUES ('race-a', 'Race A'), ('race-b', 'Race B');
    INSERT INTO students (parent_id, name) VALUES (1, 'Student A'), (2, 'Student B');
    INSERT INTO trial_classes (subject, starts_at, price_cents, capacity) VALUES
      ('Race class', now() + interval '1 day', 2500, 1);
    INSERT INTO bookings (student_id, trial_class_id, status, amount_cents) VALUES
      (1, 1, 'pending_payment', 2500),
      (2, 1, 'pending_payment', 2500);
  `);
});

test("last seat allows one confirmation and never charges the loser", async () => {
  const payments = new SuccessfulPayment();
  const service = new BookingService(new BookingRepository(getPool()), payments);
  const results = await Promise.all([service.pay(1), service.pay(2)]);
  const statuses = results.map((result) => result.status).sort();

  assert.deepEqual(statuses, ["confirmed", "seat_unavailable"]);
  assert.equal(payments.calls, 1);
  const consistency = await getPool().query<{ seats_taken: number; occupying: number }>(
    `SELECT c.seats_taken, count(b.id)::int AS occupying
     FROM trial_classes c
     LEFT JOIN bookings b ON b.trial_class_id = c.id
       AND b.status IN ('seat_held', 'confirmed')
     GROUP BY c.id, c.seats_taken`,
  );
  assert.equal(consistency.rows[0].seats_taken, 1);
  assert.equal(consistency.rows[0].occupying, 1);
});

after(async () => {
  await closePool();
});
