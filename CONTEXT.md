# Trial Booking

Parents book and pay for a one-off trial class for their child, and staff need an
accurate roster before the class starts. Trial booking only: regular enrollment is
out of scope.

## Language

### People

**Parent**:
An adult who books trial classes on behalf of their children. The only principal
that can create a Booking.
_Avoid_: User, account, guardian, customer

**Student**:
A child who attends a Trial Class. Always belongs to exactly one Parent.
_Avoid_: Child (acceptable in UI copy only), kid, pupil, attendee

**Admin**:
An operator who reads rosters. Not a domain entity — an operator credential, with
no relationship to any Parent or Student.
_Avoid_: Teacher, staff, superuser

### Classes and seats

**Trial Class**:
A single scheduled session a Student can trial, with a subject, a start time, a
price, and a capacity.
_Avoid_: Class, session, lesson, course, slot

**Seat**:
One unit of a Trial Class's capacity. A Seat is occupied by a Booking from the
moment it is Claimed until that Booking is Confirmed or the Seat is released.
_Avoid_: Slot, place, spot, reservation

**Claim**:
The act of taking a Seat for a Booking. Happens when the Parent submits payment,
before any money moves, and either succeeds or fails because the Trial Class is
full.
_Avoid_: Reserve, hold, lock, allocate, book

**Capture**:
Taking the Parent's money for a Booking that already holds a Seat.
_Avoid_: Payment, charge, bill, collect

**Stale Hold**:
A Seat still held by a Booking whose Capture never resolved, so the Seat is occupied
by nobody who will attend.
_Avoid_: Orphan, zombie, expired booking

**Confirmed Roster**:
The set of confirmed Bookings for a Trial Class — who is actually expected to
attend.
_Avoid_: Roster (ambiguous: also used for the operational view including held and
failed Bookings), attendance, class list

### Bookings

**Booking**:
One Parent's intent to place one Student in one Trial Class. Exists before any money
moves, and at most one Booking per Student per Trial Class is live at a time.
_Avoid_: Enrollment, registration, order, reservation

**Pending Payment**:
A Booking that has been created but whose payment has not been submitted. Occupies
no Seat and expires never.
_Avoid_: Reserved, held, provisional, draft

**Seat Held**:
A Booking that has Claimed a Seat and is awaiting Capture. Occupies a Seat but does
not appear on the Confirmed Roster.
_Avoid_: Reserved, pending, locked, provisional

**Confirmed**:
A Booking that holds a Seat and whose Capture succeeded. The only status that appears
on the Confirmed Roster.
_Avoid_: Paid, active, complete, booked

**Payment Failed**:
A Booking whose Capture was declined. Its Seat is released and the Parent may try
again. No money was taken.
_Avoid_: Declined, rejected, failed, cancelled

**Seat Unavailable**:
A Booking whose Claim failed because the Trial Class was already full. Terminal, and
no money was ever taken.
_Avoid_: Cancelled, lost, sold out, waitlisted

### Money

**Payment Attempt**:
A single Capture interaction with the payment provider for a Booking. A Booking may
accumulate several over its life.
_Avoid_: Payment, transaction, charge

**Idempotency Key**:
A value identifying one Payment Attempt, so that repeating a request resolves to the
original outcome instead of moving money twice.
_Avoid_: Request id, token, nonce

**Unknown Outcome**:
A Payment Attempt whose result was never observed, so it is not known whether money
moved. Resolved by retrying with the same Idempotency Key.
_Avoid_: Pending, timeout, in-flight, error

**Last-Seat Race**:
Two or more Parents submitting payment for the final Seat of the same Trial Class.
Exactly one may Claim it and be Confirmed; the others become Seat Unavailable and are
never charged.
_Avoid_: Overbooking, conflict, collision
