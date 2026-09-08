-- Trial booking schema. IDs are internal database identities; authorization never
-- relies on their opacity.

CREATE TABLE parents (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username   text NOT NULL UNIQUE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE students (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id  bigint NOT NULL REFERENCES parents (id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX students_parent_id_idx ON students (parent_id);

CREATE TABLE trial_classes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject     text NOT NULL,
  starts_at   timestamptz NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  capacity    integer NOT NULL DEFAULT 4 CHECK (capacity > 0),
  seats_taken integer NOT NULL DEFAULT 0 CHECK (seats_taken >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trial_classes_capacity_not_exceeded CHECK (seats_taken <= capacity)
);

CREATE TABLE bookings (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id      bigint NOT NULL REFERENCES students (id),
  trial_class_id  bigint NOT NULL REFERENCES trial_classes (id),
  status          text NOT NULL CHECK (status IN (
                    'pending_payment', 'seat_held', 'confirmed',
                    'payment_failed', 'seat_unavailable'
                  )),
  amount_cents    integer NOT NULL CHECK (amount_cents >= 0),
  held_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_active_booking_per_student_class
  ON bookings (student_id, trial_class_id)
  WHERE status IN ('pending_payment', 'seat_held', 'confirmed');

CREATE INDEX bookings_trial_class_id_idx ON bookings (trial_class_id);

CREATE TABLE payment_attempts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id      bigint NOT NULL REFERENCES bookings (id),
  status          text NOT NULL CHECK (status IN (
                    'processing', 'succeeded', 'failed', 'unknown'
                  )),
  amount_cents    integer NOT NULL CHECK (amount_cents >= 0),
  idempotency_key text NOT NULL UNIQUE,
  provider_ref    text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz
);

CREATE UNIQUE INDEX one_inflight_attempt_per_booking
  ON payment_attempts (booking_id)
  WHERE status IN ('processing', 'unknown');

CREATE INDEX payment_attempts_booking_id_idx ON payment_attempts (booking_id);
