/**
 * Drives the real endpoints concurrently for the Last-Seat Race: same code path the
 * browser uses, no test doubles. Needs `pnpm dev` running.
 *
 *   pnpm race:demo
 */
import { closePool, getPool } from "../src/infra/db/pool";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3000";

const CONTENDERS = [
  { username: "alice", studentId: 1 },
  { username: "bob", studentId: 2 },
  { username: "carol", studentId: 3 },
  { username: "alice", studentId: 4 },
  { username: "bob", studentId: 5 },
];

async function login(username: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/v1/sessions`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({ username }),
  });
  const cookie = response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error(`login failed for ${username} (${response.status})`);
  }
  return cookie.split(";")[0];
}

async function createBooking(cookie: string, studentId: number, trialClassId: number): Promise<number> {
  const response = await fetch(`${BASE_URL}/api/v1/bookings`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie },
    body: new URLSearchParams({
      student_id: String(studentId),
      trial_class_id: String(trialClassId),
    }),
  });
  const location = response.headers.get("location");
  if (!location) {
    throw new Error(`booking failed for student ${studentId} (${response.status})`);
  }
  return Number(location.split("/").pop());
}

async function pay(cookie: string, bookingId: number): Promise<void> {
  await fetch(`${BASE_URL}/api/v1/bookings/${bookingId}/payments`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie },
    body: new URLSearchParams({ force: "ok" }),
  });
}

async function main(): Promise<void> {
  const pool = getPool();
  const created = await pool.query<{ id: number }>(
    `INSERT INTO trial_classes (subject, starts_at, price_cents, capacity)
     VALUES ('Race demo', now() + interval '7 days', 2500, 1)
     RETURNING id`,
  );
  const trialClassId = Number(created.rows[0].id);
  console.log(`Trial class ${trialClassId}: capacity 1, ${CONTENDERS.length} parents submitting payment.\n`);

  const sessions = await Promise.all(
    CONTENDERS.map(async (contender) => ({
      ...contender,
      cookie: await login(contender.username),
    })),
  );
  const bookings = await Promise.all(
    sessions.map(async (session) => ({
      ...session,
      bookingId: await createBooking(session.cookie, session.studentId, trialClassId),
    })),
  );

  await Promise.all(bookings.map((booking) => pay(booking.cookie, booking.bookingId)));

  const outcomes = await pool.query<{
    booking_id: number;
    student: string;
    status: string;
    attempts: number;
  }>(
    `SELECT b.id AS booking_id, s.name AS student, b.status,
            (SELECT count(*)::int FROM payment_attempts a WHERE a.booking_id = b.id) AS attempts
     FROM bookings b JOIN students s ON s.id = b.student_id
     WHERE b.trial_class_id = $1
     ORDER BY b.id`,
    [trialClassId],
  );
  console.table(outcomes.rows);

  const consistency = await pool.query<{ seats_taken: number; occupying: number; attempts: number }>(
    `SELECT c.seats_taken,
            (SELECT count(*)::int FROM bookings b
             WHERE b.trial_class_id = c.id AND b.status IN ('seat_held', 'confirmed')) AS occupying,
            (SELECT count(*)::int FROM payment_attempts a
             JOIN bookings b ON b.id = a.booking_id WHERE b.trial_class_id = c.id) AS attempts
     FROM trial_classes c WHERE c.id = $1`,
    [trialClassId],
  );
  const { seats_taken, occupying, attempts } = consistency.rows[0];
  console.log(
    `\nseats_taken ${seats_taken} · seat-occupying bookings ${occupying} · payment attempts ${attempts}`,
  );
  console.log(
    Number(seats_taken) === Number(occupying) && Number(attempts) === 1
      ? "OK: one seat, one charge, losers never reached the provider."
      : "FAIL: invariant broken.",
  );
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
