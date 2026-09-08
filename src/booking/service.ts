import type {
  Booking,
  CaptureOutcome,
  PaymentService,
} from "../domain/types";
import { BookingRepository } from "./repository";

export class BookingService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly payments: PaymentService,
  ) {}

  createBooking(studentId: number, trialClassId: number): Promise<Booking> {
    return this.repository.createOrGet(studentId, trialClassId);
  }

  async pay(bookingId: number, force?: "ok" | "decline" | "timeout"): Promise<Booking> {
    const prepared = await this.repository.preparePayment(bookingId);
    if (prepared.kind === "unavailable" || prepared.kind === "settled") {
      return prepared.booking;
    }
    if (prepared.kind === "existing" && prepared.attempt?.status === "processing") {
      return prepared.booking;
    }
    if (prepared.kind === "existing" && prepared.attempt?.status !== "unknown") {
      return prepared.booking;
    }
    if (!prepared.attempt) {
      throw new Error("payment attempt was not prepared");
    }
    const attempt = prepared.attempt;
    let outcome: CaptureOutcome;
    try {
      outcome = await this.payments.charge({
        idempotencyKey: attempt.idempotencyKey,
        amountCents: attempt.amountCents,
        bookingId,
        force,
      });
    } catch (error) {
      outcome = { kind: "unknown", reason: (error as Error).message };
    }
    return this.repository.settleCapture(attempt.id, this.mapOutcome(outcome));
  }

  private mapOutcome(outcome: CaptureOutcome): {
    status: "succeeded" | "failed" | "unknown";
    providerRef?: string;
    error?: string;
  } {
    if (outcome.kind === "succeeded") {
      return { status: "succeeded", providerRef: outcome.providerRef };
    }
    if (outcome.kind === "declined") {
      return { status: "failed", error: outcome.reason };
    }
    return { status: "unknown", error: outcome.reason };
  }
}
