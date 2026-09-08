---
title: Initial Design
description: Initial design for solving the booking class requirement
---

# Problem

Trial class booking, refer [requirement](./requirement.txt).

Vocabulary for every term below is fixed in [CONTEXT.md](../CONTEXT.md); schema,
service, and UI names all come from there.

# Initial Solution

## My Solution Theme

YAGNI. Invariants live in the schema, not in application discipline; anything the
requirement does not ask for is either cut or written down as a cut.

## Assumption & Constraint

- Parents and students are seeded; there is no signup.
- Payment provider is mocked by a separate Node HTTP server in this repo.
- Parent login is username-only, no password.
- Admin is an operator credential from `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`,
  both default `admin`), not a domain entity. Admin surfaces are read-only, so admin
  actions have no audit trail.
- Reviewer setup is three commands: `docker compose up -d`, `pnpm install`,
  `pnpm dev`.

## Entities

Five tables, matching the requirement's suggested model:

- `parents`
- `students` → fk `parent_id`
- `trial_classes` — `subject`, `starts_at`, `price_cents`, `capacity` (default 4),
  `seats_taken`
- `bookings` → fk `student_id`, `trial_class_id`; `status`, `amount_cents`,
  `held_at`
- `payment_attempts` → fk `booking_id`; `status`, `amount_cents`,
  `idempotency_key`, `provider_ref`, `error`, `settled_at`

Enumerations are `text` + `CHECK`, never Postgres `ENUM` (no casts with raw `pg`,
allowed values visible in the migration):

- `bookings.status`: `pending_payment` | `seat_held` | `confirmed` |
  `payment_failed` | `seat_unavailable`. No `cancelled` — nothing cancels.
- `payment_attempts.status`: `processing` | `succeeded` | `failed` | `unknown`

`seats_taken` counts `seat_held` **and** `confirmed` bookings: a held seat is a taken
seat. Price is snapshotted from the class onto the booking, and from the booking onto
each attempt, so a price change cannot rewrite financial history.

## Booking Flow

Claim-then-capture. The seat is taken **before** any money moves, at the moment the
parent submits payment — not at booking creation.

```
create booking            claim seat            capture              confirm
(no seat)        →        (seat_held)     →     (charge)      →     (confirmed)
                              ↓ full                ↓ decline           ↓ unknown
                       seat_unavailable       release seat +        stay held,
                       (never charged)        payment_failed        retry replays
```

Why not charge first and refund the loser: the loser is never charged at all, and the
compensating action for a decline is a **local seat release** that cannot fail,
instead of a **remote refund** that can. We never take money we cannot honour, and
there is no refund apparatus to build.

Why the seat is not claimed at booking creation: the required scenario has both
parents reaching the payment step for the same seat. Claiming at creation would
refuse the second parent at selection time, and would need a real abandonment TTL.

Why confirm happens after capture, not with the claim: confirming first would put an
unpaid child on the confirmed roster for the duration of the charge, which is
observable via the roster endpoint.

## Transaction Boundaries

Two committed transactions with the network call outside both. An idempotency record
must be durable *before* the side effect it protects; holding a transaction open
across the charge would roll the attempt row back on a crash, losing the key and
double-charging on retry.

```sql
-- T1: claim, then make the attempt durable
BEGIN;
  UPDATE trial_classes SET seats_taken = seats_taken + 1
   WHERE id = $classId AND seats_taken < capacity
   RETURNING seats_taken;                    -- 0 rows => full
  -- 0 rows: UPDATE bookings SET status='seat_unavailable'
  --          WHERE id=$1 AND status='pending_payment';  COMMIT; done, never charged
  INSERT INTO payment_attempts (id, booking_id, status, amount_cents, idempotency_key)
  VALUES (DEFAULT, $1, 'processing', $amount, gen_random_uuid())
  RETURNING id, idempotency_key;
  UPDATE bookings SET status='seat_held', held_at=now()
   WHERE id=$1 AND status='pending_payment';
COMMIT;

-- capture: POST /charges with Idempotency-Key, no transaction open

-- T2: settle
BEGIN;
  UPDATE payment_attempts SET status=$s, provider_ref=$r, error=$e, settled_at=now()
   WHERE id=$attemptId;
  -- succeeded: UPDATE bookings SET status='confirmed'
  --             WHERE id=$1 AND status='seat_held';
  -- declined:  UPDATE trial_classes SET seats_taken = seats_taken - 1 WHERE id=$classId;
  --            UPDATE bookings SET status='payment_failed'
  --             WHERE id=$1 AND status='seat_held';
  -- unknown:   leave the hold in place
COMMIT;
```

No lock is held across a network call. T1 opens by locking the booking row
(`SELECT … FOR UPDATE`), so two concurrent submissions for the *same* booking
serialise there and the second reads the first's attempt instead of racing it; the
in-flight unique index remains the backstop that makes a double charge impossible
even if that lock were removed. Contention between *different* parents is unaffected —
they lock different booking rows and meet only at the conditional capacity `UPDATE`.

## Critical Flow

- **Avoid overbook** — capacity is a database invariant, not a code rule:
  `CHECK (seats_taken <= capacity)`, claimed with the single conditional statement
  above. Zero rows returned means full. Correct at `READ COMMITTED`, row lock held
  for microseconds. `seats_taken` is derived data, so `claimSeat`/`releaseSeat` are
  its only writers and every test asserts
  `seats_taken = COUNT(*) WHERE status IN ('seat_held','confirmed')`.
- **Avoid duplicate booking** — `UNIQUE (student_id, trial_class_id)
  WHERE status IN ('pending_payment','seat_held','confirmed')`. Creation is
  `INSERT … ON CONFLICT (student_id, trial_class_id)
  WHERE status IN (…) DO NOTHING` followed by a `SELECT`, so two tabs or two devices
  converge on one `booking_id`. The predicate must be spelled in the conflict target
  for Postgres to infer a partial index as the arbiter. `payment_failed` and
  `seat_unavailable` fall outside it, so retry and rebooking still work.
- **Avoid double settlement** — every transition is conditional
  (`… WHERE id=$1 AND status='seat_held'`). Zero rows means already settled, so a
  replayed request is a no-op.
- **Avoid double charge** — `UNIQUE (booking_id) WHERE status IN
  ('processing','unknown')`. A concurrent payment submission blocks on the booking's
  row lock, then reads the live attempt and renders "payment in progress — refresh"
  rather than charging. The index makes the invariant true regardless of the lock.
- **If payment fails, do not add the child to the roster** — the booking is never
  `confirmed` on a decline, and its seat is released in the same transaction.
- **Last-seat race** — both parents submit payment; exactly one claim succeeds. The
  loser becomes `seat_unavailable` **without a single provider call**.

Both duplicate paths are resolved without an exception to catch: booking creation
uses `ON CONFLICT … DO NOTHING` plus a `SELECT`, and concurrent payment submissions
serialise on the booking row lock. The partial unique indexes remain the arbiters —
they are what makes the invariant true rather than merely likely — but no application
code branches on `23505`.

## Idempotency

One key: `payment_attempts.idempotency_key`, server-generated per attempt and sent to
the provider as `Idempotency-Key`. Per-attempt, not per-booking — a per-booking key
would make the provider replay a cached decline forever, so a genuine retry could
never succeed.

There is no booking-level idempotency key. Creation idempotency is the natural key
`(student_id, trial_class_id)` plus `ON CONFLICT DO NOTHING`, which is also what makes
creation safe across tabs and devices. A client-side key cannot provide cross-device
safety anyway: the second device has no way to learn the first device's key, and if
the server could tell it, the server already has the row.

Key conflict means **replay, not error**: read the existing row and return its
outcome, never `409`.

## Payment Timeout And Recovery

A charge that aborts leaves the outcome genuinely unknown, so the attempt stays
`unknown` and the booking **keeps its seat**. The parent's retry reuses that same
attempt and its key, so the provider replays the original outcome instead of charging
twice. The parent does not lose the seat while the ambiguity is resolved.

Stale holds — a seat held by a booking whose capture never resolved — are recovered
lazily on the claim path: when a claim returns zero rows, release holds for that class
older than `HOLD_TTL_SECONDS` whose attempt is absent or `failed`, then retry the
claim once. This runs only when a class *appears* full, i.e. only when the leak
actually harms someone, and never writes on a read path. A released hold becomes
`payment_failed`, not `seat_unavailable`: its claim succeeded, so the parent may try
again.

An attempt still `processing` past the same TTL is a request that died between
committing the attempt and settling it. It is aged into `unknown` on the next payment
submission, so the in-flight unique index cannot turn a crashed request into a
permanent lockout; the retry replays the original idempotency key.

Holds whose attempt is `unknown` are **never** released automatically: the charge may
have succeeded, and releasing the seat would leave a parent charged with nothing.
They are surfaced on the admin roster as "needs reconciliation" and are resolved by
`POST /api/v1/internal/sweep-holds`, which releases stale holds and then asks the
provider `GET /charges/:idempotency_key` for each `unknown` attempt, confirming or
releasing accordingly. A provider that still answers "unknown" leaves the hold alone.
The endpoint is manual by design; running it on a schedule is the documented next
step, not built.

## HTTP Session

Cookie-based. Signed (HMAC) `HttpOnly`, `SameSite=Lax` cookie holding a discriminated
union — `{ kind: 'parent', parentId }` or `{ kind: 'admin' }`. No session table, so
restarts do not log you out.

Separate login pages for parent and admin.

## Authorization

Two layers, per Next's own guidance:

- `src/proxy.ts` (**not** `middleware.ts` — renamed and deprecated in Next 16) does
  cookie-only optimistic checks for redirect UX. No database imports. Matcher covers
  `/admin/:path*`, parent pages, and `/api/v1/:path*` **except** the session
  endpoints.
- `requireParent()` / `requireAdmin()` plus the ownership check
  (`student.parent_id = session.parentId`) are authoritative, at every route handler
  and page data fetch. Deleting `src/proxy.ts` must leave every endpoint secure.

## Checks By Tier

| tier | responsibility |
| --- | --- |
| UI | affordances only — full classes shown disabled, not hidden |
| `src/proxy.ts` | optimistic redirect UX |
| backend | authorization, ownership, orchestration, compensation |
| database | capacity `CHECK`, both partial unique indexes, conditional transitions |
| background job | none automatic — stale-hold release is lazy on the claim path; abandoned `processing` attempts age into `unknown` on the next submission; `unknown` reconciliation is the manual sweep endpoint |

## API

Route handlers only; no server actions. Pages are server-rendered plain HTML forms
posting straight to `/api/v1/*`, and finish with a hand-rolled `303 + Location`
(Next's `redirect()` emits `307` in a route handler, which would re-POST). Pages read
the database directly through repositories rather than fetching this app's own API.
One consequence matters: the race test and the browser exercise exactly the same code
path, and the whole app works without client JavaScript.

| method + path | purpose |
| --- | --- |
| `POST /api/v1/sessions` | parent login |
| `POST /api/v1/sessions/logout` | parent logout (HTML forms cannot send `DELETE`) |
| `POST /api/v1/admin/sessions` | admin login |
| `GET /api/v1/classes` | list with live seat availability |
| `POST /api/v1/bookings` | create-or-return `pending_payment` |
| `POST /api/v1/bookings/:id/payments` | claim → capture → confirm \| release |
| `GET /api/v1/bookings/:id` | booking status |
| `GET /api/v1/admin/classes/:id/roster` | roster (admin only) |
| `POST /api/v1/internal/sweep-holds` | manual stale-hold release + `unknown` reconciliation |

## Pages

`/login`, `/admin/login`, `/classes`, `/classes/:id`, `/bookings/:id` (renders the
payment form while `pending_payment`, "payment in progress" while `seat_held`, a
retry button when that hold's attempt is `unknown`, the outcome once terminal), and
the admin roster. All `dynamic = 'force-dynamic'`;
database reads are uncached and prerender-blocking, so seat counts would otherwise go
stale.

Creating a booking and paying stay two separate requests, deliberately: that is what
lets two browser tabs both sit on a payment form and stage the last-seat race.

The admin roster shows the confirmed roster first, then `seat_held`,
`payment_failed`, and `seat_unavailable` sections, flags holds needing
reconciliation, and displays the `seats_taken` vs row-count consistency check.

## Mock Payment Provider

Separate Node process in this repo, started alongside Next by `pnpm dev` via
`concurrently`. Not containerized. Called over HTTP through a `PaymentService`
interface, so swapping in a real provider is one class. No refund endpoint — the
design never needs one.

- `POST /charges`, `GET /charges/:idempotency_key`, `POST`/`GET /control`
- Honours `Idempotency-Key`; memo persisted to a JSON file so a restart does not
  silently void the replay guarantee.
- Outcome precedence: `X-Force-Payment: ok|decline|timeout` header → runtime mode set
  via `POST /control` → `ok`. Mode resets to `ok` on boot. Tests always send the
  header, so they are hermetic and order-independent; the control endpoint exists for
  browser demos, which cannot set headers.
- Client side: `AbortSignal.timeout(5000)`. No database transaction is open during
  the call, so a hung provider parks no locks.

## DB

Postgres, containerized via `docker compose` — Postgres only. Next and the mock run
on the host so HMR survives.

Raw `pg` with hand-written SQL and `.sql` migrations; no ORM or query builder. The
invariants *are* the SQL, and partial indexes, `CHECK` constraints, `ON CONFLICT`,
and `UPDATE … RETURNING` are all first-class rather than escape hatches. Row types
and status string-unions are hand-written next to the repositories.

- `migrations/NNNN_*.sql`, applied by `scripts/migrate.ts` (~30 lines) tracking
  applied filenames in `schema_migrations`, one transaction per file, so
  `pnpm db:migrate` is safe to re-run.
- `pnpm db:reset` = drop schema + migrate + seed.

## Code Style

- Feature-based directories under `src/`; `src/infra/` holds the pool and other
  plumbing. Next route files live under `src/app/`.
- DI by constructor: `PaymentService`, `TrialClassService`, `TrialClassRepository`.
- All HTTP under `/api/v1`.
- Every `if` / `else` / loop body uses curly braces, always — no single-line or
  brace-less bodies, even for early returns and guard clauses.
- Comments explain non-obvious invariants or tradeoffs only; do not narrate obvious
  code or restate the implementation.
- Keep line lengths readable: break long function calls, SQL fragments, object
  literals, JSX, and conditional expressions at logical boundaries; do not compress
  unrelated expressions onto one line.

## Tests

TDD on the critical path: the race, duplicate, decline, and timeout tests are written
before the service code they exercise. Migrations run once for the suite, then each
test does `TRUNCATE … RESTART IDENTITY CASCADE` + reseed.

- **Integration, real Postgres** (`node:test`, zero dependencies) for every
  invariant. The race test uses a 1-capacity class and ≥5 concurrent payment
  submissions, looped ~10 times, asserting exactly 1 `confirmed`, N−1
  `seat_unavailable`, **exactly 1 payment attempt in total** (losers are never
  charged), and `seats_taken = COUNT(*) WHERE status IN ('seat_held','confirmed')`.
  A single two-way race passes by luck too often to be a regression test.
- Other integration cases: duplicate submission converges on one booking; decline
  releases the seat and leaves capacity restored; a timeout leaves an `unknown`
  attempt with the seat still held, and a retry replays the original outcome rather
  than charging twice; an abandoned `processing` attempt ages into `unknown` instead
  of locking the booking out; a stale hold is released when a later claim finds the
  class full; the sweep endpoint releases and reconciles.
- **Unit, mocked repository** for orchestration branches only: claim fails → no
  provider call at all; decline → release exactly once; `unknown` → hold retained;
  live attempt → reused rather than re-charged.
- Mocked-repo tests cannot prove any invariant: delete every constraint from the
  migrations and they stay green. That is why the integration suite comes first.
- `scripts/race-demo.ts` drives the real endpoints concurrently and prints an
  outcome table — the verification steps for the README and the video.

## Seed

`scripts/seed.sql`, fixed integer IDs so the README and demo script can reference
concrete rows and reruns are byte-identical. IDs use PostgreSQL `bigint` identity
columns because this is one internal database with server-side writes; UUIDs add
size and verbosity without a needed guarantee. `seats_taken` is set by SQL from the
booking rows, so the seed cannot itself violate the capacity invariant.

| class | state | purpose |
| --- | --- | --- |
| C1 | 0/4 | class with available seats |
| C2 | 3/4 confirmed | last-seat race target |
| C3 | 4/4 confirmed | full — shown disabled |
| C4 | 1/4 | holds the `payment_failed` booking |

Plus a student already confirmed in C2 (the duplicate-attempt precondition — a
rejected duplicate is never stored, since creation returns the existing booking), a
`payment_failed` booking with its failed attempt, a `seat_unavailable` booking with
**no** payment attempt (proving the loser is never charged), and one stale `seat_held`
booking with an old `held_at` so the lazy release path is demonstrable.

## Build Order

Vertical slice, so the graded core is proven before any UI exists: migrations + pool
→ race test (red) → `BookingService` (green) → mock provider → booking + payment
endpoints → roster → pages → auth → README.

Pre-agreed cut order if time runs out: unit tests → memo file persistence →
`/control` endpoint → stale-hold release (leave the manual sweep endpoint) → admin
login page (fall back to an env token) → `src/proxy.ts`.

Honest estimate is ~6–7h against a 4h cap, so 4h is a checkpoint, not a wall: stop,
log actual time spent, and ship with the remaining cut list written down.

## Deliberately Cut

- No refunds anywhere — claim-then-capture means the loser is never charged.
- Scheduled reconciliation of `unknown` attempts (the sweep endpoint exists; nothing
  calls it on a timer).
- No cancellation, no waitlist, no abandonment expiry (`pending_payment` holds
  nothing, so there is nothing to expire).
- No cross-class scheduling constraint: a student may book two overlapping trial
  classes, and may trial the same subject twice in different classes.
- Admin is read-only, so no audit trail.
- No ADRs: the README carries the decisions, `CONTEXT.md` carries the vocabulary.

## Docs

`README.md` (how to run, what was built, time spent, assumptions, architecture and
backend decisions, what was cut, what to monitor, what is next), `AI_USAGE.md`, and
`CONTEXT.md`.
