import type { CaptureOutcome, PaymentService } from "../domain/types";

/**
 * Anything that is not an unambiguous success or decline is `unknown`: guessing on a
 * money path would either confirm an unpaid Booking or release a paid-for Seat.
 */
function toOutcome(body: Record<string, unknown>): CaptureOutcome {
  if (body.status === "succeeded" && typeof body.providerRef === "string") {
    return { kind: "succeeded", providerRef: body.providerRef };
  }
  if (body.status === "declined") {
    return {
      kind: "declined",
      reason: typeof body.reason === "string" ? body.reason : "payment_declined",
    };
  }
  return { kind: "unknown", reason: String(body.reason ?? "payment_unknown") };
}

export class HttpPaymentService implements PaymentService {
  constructor(
    private readonly baseUrl = process.env.PAYMENT_SERVICE_URL ?? "http://localhost:4001",
    private readonly timeoutMs = Number(process.env.PAYMENT_TIMEOUT_MS ?? 5000),
  ) {}

  async charge(input: Parameters<PaymentService["charge"]>[0]): Promise<CaptureOutcome> {
    try {
      const response = await fetch(`${this.baseUrl}/charges`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
          ...(input.force ? { "x-force-payment": input.force } : {}),
        },
        body: JSON.stringify({ bookingId: input.bookingId, amountCents: input.amountCents }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return toOutcome((await response.json()) as Record<string, unknown>);
    } catch (error) {
      return { kind: "unknown", reason: (error as Error).message };
    }
  }

  async lookup(idempotencyKey: string): Promise<CaptureOutcome | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/charges/${encodeURIComponent(idempotencyKey)}`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (response.status === 404) {
        return null;
      }
      return toOutcome((await response.json()) as Record<string, unknown>);
    } catch {
      return null;
    }
  }
}
