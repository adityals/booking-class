---
author: Aditya Septiadi
date: MMMM dd, YYYY
paging: Slide %d / %d
---

# Trial Booking Reliability

Ottodot take-home: trial class booking, **4 seats per class**

Scope: book, pay (mock), see status, admin roster. Nothing else.

What this walkthrough covers:

1. High-level architecture
2. Entities
3. Booking and payment states
4. **The four invariants**
   - duplicate confirmed bookings
   - overbooking beyond 4
   - payment failure never reaches the roster
   - the last-seat race
5. Trade-offs of the last-seat decision

---

## High-level architecture

```
  Parent browser          Admin browser
  (server-rendered forms) (roster page)
          |                     |
          v                     v
  +------------------------------------------+
  | Next.js  src/app  (pages + route handlers)|
  |   /api/v1/bookings, /payments, /roster    |
  +------------------------------------------+
          |
          v
  +------------------+       HTTP + Idempotency-Key
  | BookingService   | ----------------------------> +--------------+
  |  (state machine) |                               | Payment mock |
  +------------------+ <---------------------------- | :4001        |
          |              succeeded / declined /      +--------------+
          v              unknown (timeout)
  +------------------+
  | BookingRepository|  raw `pg`, one transaction per step
  +------------------+
          |
          v
  +------------------------------------------+
  | PostgreSQL (Docker)                       |
  |  CHECK + partial UNIQUE indexes           |
  |  = source of truth for concurrency        |
  +------------------------------------------+
```

---

## Entities

| table | key columns | role |
| --- | --- | --- |
| `parents` | `username` | seeded parent login |
| `students` | `parent_id` | children of a parent |
| `trial_classes` | `capacity = 4`, **`seats_taken`** | the seat counter |
| `bookings` | `student_id`, `trial_class_id`, `status` | intent + lifecycle |
| `payment_attempts` | `booking_id`, **`idempotency_key`**, `status` | one provider capture |

```
parents 1──* students 1──* bookings *──1 trial_classes
                               │
                               1
                               │
                               * payment_attempts
```

- `seats_taken` = count of `seat_held` + `confirmed` bookings
- Money is integer cents, booking copies the class price at creation

---

## Booking states

| status | meaning | holds seat | on roster |
| --- | --- | :---: | :---: |
| `pending_payment` | booking exists, not paid yet | no | no |
| `seat_held` | seat claimed, capture in flight | **yes** | no |
| `confirmed` | capture succeeded | **yes** | **yes** |
| `payment_failed` | capture declined, seat released | no | no |
| `seat_unavailable` | lost the last seat, never charged | no | no |

```
                  create
                    |
                    v
             pending_payment ---- claim fails ----> seat_unavailable
                    |
               claim succeeds
                    v
               seat_held  <--- capture unknown (stay, retry same key)
                /       \
     capture ok          capture declined
          v                    v
      confirmed          payment_failed  (seats_taken - 1)
```

Key point: **only `confirmed` is on the roster.** Holding a seat is not being enrolled.

---

## Payment attempt states

| status | meaning | next |
| --- | --- | --- |
| `processing` | committed, provider call in progress | settle |
| `succeeded` | provider captured | booking -> `confirmed` |
| `failed` | provider declined | booking -> `payment_failed`, release seat |
| `unknown` | timeout, we did not see the result | retry with **same** key |

Rules:

- One attempt = one idempotency key. Retries reuse it, so no double charge.
- At most one in-flight attempt per booking (DB-enforced):

```sql
CREATE UNIQUE INDEX one_inflight_attempt_per_booking
  ON payment_attempts (booking_id)
  WHERE status IN ('processing', 'unknown');
```

- Anything not clearly `succeeded`/`declined` maps to `unknown`.
  Guessing on a money path either confirms unpaid, or frees a paid seat.

---

## Where each check lives

| layer | owns |
| --- | --- |
| UI | disables full classes (hint only, **not** correctness) |
| Backend | auth, parent owns child/booking, state transitions |
| Database | capacity, one active booking, one in-flight attempt |
| Job (manual now) | `POST /api/v1/internal/sweep-holds`: stale holds, unknown attempts |

Why the database: correctness must survive
multiple Next.js processes and concurrent requests.
An app-level "read count, then insert" has a race window. A constraint does not.

---

## Key 1: Duplicate confirmed bookings

**Rule:** one *active* booking per (child, class).

```sql
CREATE UNIQUE INDEX one_active_booking_per_student_class
  ON bookings (student_id, trial_class_id)
  WHERE status IN ('pending_payment', 'seat_held', 'confirmed');
```

Create is idempotent, a duplicate returns the existing booking:

```ts
// src/booking/repository.ts  createOrGet()
INSERT INTO bookings (student_id, trial_class_id, status, amount_cents)
SELECT $1, id, 'pending_payment', price_cents FROM trial_classes WHERE id = $2
ON CONFLICT (student_id, trial_class_id)
WHERE status IN ('pending_payment', 'seat_held', 'confirmed')
DO NOTHING
RETURNING ...
// no row returned -> SELECT the existing active booking
```

- Works across tabs and devices: key is the domain identity, not a client token
- `payment_failed` / `seat_unavailable` are outside the index, so the parent can rebook
- Demo: `alice` -> Math -> Ava (already confirmed) returns the same booking

---

## Key 2: Overbooking beyond 4

**Rule:** `seats_taken <= capacity`, always.

Constraint as the last line of defense:

```sql
CONSTRAINT trial_classes_capacity_not_exceeded CHECK (seats_taken <= capacity)
```

Seat claim is one conditional, atomic write:

```ts
// src/booking/repository.ts  claimSeat()
UPDATE trial_classes
SET seats_taken = seats_taken + 1
WHERE id = $1 AND seats_taken < capacity
RETURNING id
// 1 row  -> seat is yours
// 0 rows -> class full
```

- No `SELECT count(*)` then `INSERT`, so no read-then-write window
- Postgres row lock serializes concurrent claims on the same class
- Seed: a class with exactly 3 confirmed -> one seat left

---

## Key 3: Payment failure stays off the roster

Order of operations in `BookingService.pay()`:

```
tx 1: claim seat + insert attempt(processing) + booking -> seat_held   COMMIT
      |
      v
network: POST /charges  (Idempotency-Key)      <- no DB tx held open
      |
      v
tx 2: settleCapture()
        succeeded -> confirmed        (roster)
        declined  -> payment_failed   + seats_taken - 1
        unknown   -> stay seat_held   (retry same key / sweep)
```

- Roster reads `status = 'confirmed'` only; `seat_held` never shows as enrolled
- Attempt is committed **before** the network call, so a crash keeps the key
- Demo: set mock to **Decline** -> no roster entry, capacity restored

---

## Key 3: the decline path in code

```ts
// src/booking/repository.ts  settleCapture()
if (outcome.status === "unknown") {
  return this.getBooking(tx, attempt.booking_id);   // keep the seat
}
if (outcome.status === "succeeded") {
  return this.getBookingAfterUpdate(tx, attempt.booking_id, "confirmed");
}

// declined: give the seat back, only if this booking still holds it
await tx.query(
  `UPDATE trial_classes c
   SET seats_taken = seats_taken - 1
   FROM bookings b
   WHERE b.id = $1 AND c.id = b.trial_class_id AND b.status = 'seat_held'`,
  [attempt.booking_id],
);
return this.getBookingAfterUpdate(tx, attempt.booking_id, "payment_failed");
```

`... AND status = 'seat_held'` guards make settlement idempotent:
a repeated settle cannot release a seat twice.

---

## Key 4: The last-seat race (the scenario)

Class has 1 seat left.

```
  User A              User B              PostgreSQL           Payment mock
    |                   |                     |                     |
 1  |-- create booking ---------------------->|                     |
    |<-- pending_payment (no seat taken) -----|                     |
 2  |                   |-- create booking -->|                     |
    |                   |<-- pending_payment -|                     |
 3  |                   |-- pay: claim ------>|                     |
    |                   |   seats 3 -> 4      |                     |
    |                   |<-- seat_held -------|                     |
    |                   |-- capture (key B) ----------------------->|
    |                   |<-- succeeded -----------------------------|
    |                   |-- settle ---------->|                     |
    |                   |<-- confirmed -------|                     |
 4  |-- pay: claim -------------------------->|                     |
    |   WHERE seats_taken < capacity: 0 rows  |                     |
    |<-- seat_unavailable --------------------|                     |
    |                   |                     |   (never called     |
    |                   |                     |    for User A)      |
```

**At most one confirmed booking for the last seat.**
Winner = first claim `UPDATE` to commit. Same-millisecond submits are
serialized by the row lock on `trial_classes`: one gets 1 row, the other 0.

---

## Key 4: the claim decides, before any money moves

```ts
// src/booking/repository.ts  preparePayment()  (inside one transaction)
SELECT ... FROM bookings WHERE id = $1 FOR UPDATE;   // serialize same-booking retries

if (booking.status is terminal) return settled;       // repeat submit = no-op
if (in-flight attempt exists)  return existing;       // double click = no 2nd charge

const claimed = await this.claimSeatWithRecovery(tx, booking.trialClassId);
if (!claimed) {
  UPDATE bookings SET status = 'seat_unavailable'
  WHERE id = $1 AND status = 'pending_payment';
  return { kind: "unavailable" };                     // provider never called
}

INSERT INTO payment_attempts (..., status, idempotency_key)
VALUES (..., 'processing', randomUUID());
UPDATE bookings SET status = 'seat_held', held_at = now() ...;
```

`claimSeatWithRecovery`: if full, release **safe** stale holds
(old, no in-flight attempt) once, then retry the claim.

---

## Demo checklist

```bash
docker compose up -d && pnpm db:reset && pnpm dev   # http://localhost:3000
```

| # | as | do | expect |
| --- | --- | --- | --- |
| 1 | `alice` | book Science (open seats) | `confirmed` |
| 2 | `alice` | Math -> Ava again | same booking returned |
| 3 | `alice` | pay with mock **Decline** | `payment_failed`, seat back |
| 4 | terminal | `pnpm race:demo` | 1 `confirmed`, 4 `seat_unavailable` |
| 5 | `admin` | open "Race demo" roster | 1 confirmed, 4 in ops section |

Race demo (`scripts/race-demo.ts`): new class, capacity 1, 5 parents log in,
book, then `Promise.all` pay via the real HTTP endpoints (no test doubles).

```
seats_taken 1 · seat-occupying bookings 1 · payment attempts 1
OK: one seat, one charge, losers never reached the provider.
```

Regression: `pnpm test` runs the same race 10 rounds, plus duplicate create,
decline, unknown-retry (same key), abandoned attempt, and sweep cases.

Seed fixtures: Math = Ava, Ben, Cara confirmed (3/4) · Biology = Eli `payment_failed`
· Science = stale `seat_held` (Ben, no attempt) -> released lazily on a full claim

Admin login: `admin` / `admin`

---

## Trade-offs: last-seat race (1/2)

All the same decision: **where and when the last seat is consumed.**

**Claim at payment submit, not at booking creation**

- Pro: An abandoned checkout never parks the last seat
- Pro: No reservation expiry timer, no waitlist needed
- Con: Loser learns late: sees `seat_unavailable` only after clicking Pay
- Con: Several parents can sit on `pending_payment` for one seat

**Claim before capture, not capture before claim**

- Pro: Loser is never charged -> no refund flow at all
- Con: Crash between claim and settle leaves a `seat_held` with no winner
  -> recovered lazily on next claim, or by the manual sweep endpoint

---

## Trade-offs: last-seat race (2/2)

**Database decides the winner, not the application**

- Pro: One atomic `UPDATE ... WHERE seats_taken < capacity`, no app lock
- Pro: Correct across many Next.js processes
- Con: Loser fails outright; no queueing or retry into the seat

**`unknown` capture keeps the seat held**

- Release it  -> risk: parent charged, no seat (worst for trust)
- Keep it     -> risk: last seat stranded until sweep/retry
- Chosen: **never double-sell** over **never strand**

**Payment mock stores idempotency results in a JSON file**

- Enough to prove same-key replay here
- Production: real provider lookup + scheduled reconciliation worker

---

## Cut, monitor, next

**Deliberately cut:** regular enrollment, cancellation, waitlist,
reservation expiry, scheduled reconciliation, refunds (losers never charged)

**Monitor after release:**

- payment attempts by outcome + latency
  -> a jump in declines or timeouts means the provider is failing, not the parents.
- count and age of `unknown` attempts / `seat_held` holds
  -> each one is a seat nobody can book, and possibly a parent charged without a seat.
- `seat_unavailable` rate
  -> shows how often parents lose a race after checkout, i.e. real demand vs capacity.
- constraint violations, `seats_taken` vs roster mismatch
  -> should always be zero; any hit means an invariant broke and the roster is wrong.

**Next:**

1. Run the sweep on a schedule
   -> today a stuck seat stays stuck until someone calls the endpoint by hand.
2. Real provider with durable idempotency + charge lookup
   -> the JSON-file mock cannot prove same-key replay survives restarts and deploys.
3. Hold expiry + parent-facing recovery
   -> a parent with an `unknown` payment currently has no way to see or fix it.
4. Staff accounts + audit log, E2E browser tests
   -> a shared `admin` login gives no accountability, and no test covers the full UI flow.

---

# Thanks

Repo: README.md, AI_USAGE.md, docs/booking_payment_state.md
