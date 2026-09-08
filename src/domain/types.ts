export type BookingStatus =
  | "pending_payment"
  | "seat_held"
  | "confirmed"
  | "payment_failed"
  | "seat_unavailable";

export type PaymentAttemptStatus = "processing" | "succeeded" | "failed" | "unknown";

export const SEAT_OCCUPYING_STATUSES = ["seat_held", "confirmed"] as const;
export const ACTIVE_BOOKING_STATUSES = ["pending_payment", "seat_held", "confirmed"] as const;
export const IN_FLIGHT_ATTEMPT_STATUSES = ["processing", "unknown"] as const;

export interface Parent {
  id: number;
  username: string;
  name: string;
}

export interface Student {
  id: number;
  parentId: number;
  name: string;
}

export interface TrialClass {
  id: number;
  subject: string;
  startsAt: Date;
  priceCents: number;
  capacity: number;
  seatsTaken: number;
}

export interface Booking {
  id: number;
  studentId: number;
  trialClassId: number;
  status: BookingStatus;
  amountCents: number;
  heldAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentAttempt {
  id: number;
  bookingId: number;
  status: PaymentAttemptStatus;
  amountCents: number;
  idempotencyKey: string;
  providerRef: string | null;
  error: string | null;
  createdAt: Date;
  settledAt: Date | null;
}

export type CaptureOutcome =
  | { kind: "succeeded"; providerRef: string }
  | { kind: "declined"; reason: string }
  | { kind: "unknown"; reason: string };

export interface PaymentService {
  charge(input: {
    idempotencyKey: string;
    amountCents: number;
    bookingId: number;
    force?: "ok" | "decline" | "timeout";
  }): Promise<CaptureOutcome>;
  lookup(idempotencyKey: string): Promise<CaptureOutcome | null>;
}
