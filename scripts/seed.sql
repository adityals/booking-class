-- Synthetic data for the required demo cases.
-- Run after migrations with: pnpm db:seed

INSERT INTO parents (id, username, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 'alice', 'Alice Parent'),
  (2, 'bob', 'Bob Parent'),
  (3, 'carol', 'Carol Parent');

INSERT INTO students (id, parent_id, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 'Ava'),
  (2, 2, 'Ben'),
  (3, 3, 'Cara'),
  (4, 1, 'Dylan'),
  (5, 2, 'Eli');

INSERT INTO trial_classes (id, subject, starts_at, price_cents, capacity)
OVERRIDING SYSTEM VALUE VALUES
  (1, 'Science', '2030-01-10 16:00:00+00', 2500, 4),
  (2, 'Math',    '2030-01-11 16:00:00+00', 2500, 4),
  (3, 'Physics', '2030-01-12 16:00:00+00', 3000, 4),
  (4, 'Biology', '2030-01-13 16:00:00+00', 2500, 4);

-- Class 2 has exactly three confirmed students: the last-seat race fixture.
INSERT INTO bookings (id, student_id, trial_class_id, status, amount_cents, held_at)
OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 2, 'confirmed', 2500, NULL),
  (2, 2, 2, 'confirmed', 2500, NULL),
  (3, 3, 2, 'confirmed', 2500, NULL),
  (4, 4, 3, 'confirmed', 3000, NULL),
  (5, 5, 4, 'payment_failed', 2500, NULL),
  (6, 2, 1, 'seat_held', 2500, now() - interval '2 minutes');

INSERT INTO payment_attempts (id, booking_id, status, amount_cents, idempotency_key, error, settled_at)
OVERRIDING SYSTEM VALUE VALUES
  (1, 5, 'failed', 2500, 'seed-payment-failed-1', 'seed decline', now());

UPDATE trial_classes c
SET seats_taken = (
  SELECT count(*)
  FROM bookings b
  WHERE b.trial_class_id = c.id
    AND b.status IN ('seat_held', 'confirmed')
);

SELECT setval(pg_get_serial_sequence('parents', 'id'), COALESCE((SELECT max(id) FROM parents), 1));
SELECT setval(pg_get_serial_sequence('students', 'id'), COALESCE((SELECT max(id) FROM students), 1));
SELECT setval(pg_get_serial_sequence('trial_classes', 'id'), COALESCE((SELECT max(id) FROM trial_classes), 1));
SELECT setval(pg_get_serial_sequence('bookings', 'id'), COALESCE((SELECT max(id) FROM bookings), 1));
SELECT setval(pg_get_serial_sequence('payment_attempts', 'id'), COALESCE((SELECT max(id) FROM payment_attempts), 1));

-- The stale hold intentionally has no attempt: it is safe for lazy release.
