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

    const attempt = prepared.attempt;
    if (!attempt) {
      throw new Error("payment attempt was not prepared");
    }

    // An `unknown` attempt is retried with its original key so the provider replays
    // the first outcome; a `processing` one is still in flight elsewhere.
    if (prepared.kind === "existing" && attempt.status !== "unknown") {
      return prepared.booking;
    }

    const outcome = await this.payments.charge({
      idempotencyKey: attempt.idempotencyKey,
      amountCents: attempt.amountCents,
      bookingId,
      force,
    });

    return this.repository.settleCapture(attempt.id, this.mapOutcome(outcome));
  }

  /**
   * Manual recovery: release holds whose capture never resolved, then ask the
   * provider to settle the ones whose money state is genuinely unknown.
   */
  async sweep(): Promise<{ released: number; reconciled: number }> {
    const released = await this.repository.releaseStaleHolds(null);
    const pending = await this.repository.listUnknownAttempts();

    let reconciled = 0;
    for (const attempt of pending) {
      const outcome = await this.payments.lookup(attempt.idempotencyKey);
      if (!outcome || outcome.kind === "unknown") {
        continue;
      }
      await this.repository.settleCapture(attempt.id, this.mapOutcome(outcome));
      reconciled += 1;
    }

    return { released, reconciled };
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
