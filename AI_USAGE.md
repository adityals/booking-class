# AI Usage

## Tools used

- Oh My Pi coding harness with repository tools for reading, editing, searching, and running commands.
- AI agents for isolated implementation slices.
- Next.js 16.3.4 documentation bundled in `node_modules/next/dist/docs/` and the official Next.js documentation.

## What AI helped with

AI helped with:

- reviewing the initial design against `docs/requirement.txt`
- stress-testing the last-seat race and payment ordering
- shaping the PostgreSQL constraints and transaction boundaries
- checking Next.js 16 changes, including `src/app`, `proxy.ts`, async route params, cookies, and route-handler redirects
- implementing the payment mock, repositories, API routes, pages, seed data, and CSS Module styling
- generating the first integration race test

## Where AI helped most

AI made the design review faster. It turned the vague requirement to "handle the last-seat race" into a concrete state transition:

```text
pending_payment -> seat_held -> confirmed
                       |             |
                       |             +-- capture succeeds
                       +-- decline -> payment_failed
                       +-- class full -> seat_unavailable
```

That made the database invariant and the test assertion explicit before implementation.

## Where I corrected or rejected AI output

### 1. Charge-first was not required

AI initially claimed that the requirement forced `charge -> claim -> refund`. I rejected that conclusion. The requirement only prevents claiming the seat at booking creation. Claiming at payment submission lets both parents reach payment, gives the seat to the first successful claim, and avoids charging the losing parent. The implementation uses claim-before-capture and has no refund flow.

### 2. Booking-level idempotency key was unnecessary

AI proposed a booking-level idempotency key and later suggested deriving it from `hash(user_id + class_id)`. I rejected both. A booking-level key would make a provider replay a cached decline during a legitimate retry. The natural unique key `(student_id, trial_class_id)` already makes booking creation idempotent across tabs and devices. Only payment attempts need idempotency keys.

### 3. Migrations should not run from startup instrumentation

AI initially suggested running migrations during app startup. I rejected that because Next can create multiple server instances and startup hooks are the wrong place to own database migration state. Migrations run explicitly through `pnpm db:migrate` and `pnpm db:reset`.

### 4. UUIDs were unnecessary

AI initially used UUIDs. I changed the schema to PostgreSQL `bigint` identity IDs because this application has one database, server-side writes, and no distributed ID generation. Integer IDs make the schema and seed data easier to inspect.

### 5. Repository DI needed to be consistent

AI first implemented class reads with a module-level `getPool()` call. I rejected that boundary because it made the read side harder to test and inconsistent with the repository pattern. Class reads, booking reads/writes, student ownership, and parent lookup now receive a pool through repository constructors. Routes only compose repositories and translate HTTP input/output.

## Verification

I verified the implementation with:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm db:reset
pnpm test
```

The integration race test passed with one confirmed booking, one seat-unavailable booking, one payment attempt, and consistent seat counts. I also manually verified the home redirect and rendered login UI in a browser. The final manual walkthrough should cover login, booking, payment decline, logout, the race, and the admin roster.

## What I would change about the AI workflow

I would establish the repository and route contracts before delegating implementation. The first parallel pass created useful slices, but it also caused avoidable issues: stale relative imports after moving to `src/app`, duplicate JSX during concurrent edits, and missing DI consistency in read queries. A smaller contract-first batch with stricter file ownership would reduce repair work.
