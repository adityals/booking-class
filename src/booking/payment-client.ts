import type { CaptureOutcome, PaymentService } from "../domain/types";

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
      const body = (await response.json()) as Record<string, unknown>;
      if (body.status === "succeeded" && typeof body.providerRef === "string") {
        return { kind: "succeeded", providerRef: body.providerRef };
      }
      if (body.status === "declined" && typeof body.reason === "string") {
        return { kind: "declined", reason: body.reason };
      }
      return { kind: "unknown", reason: String(body.reason ?? "payment_unknown") };
    } catch (error) {
      return { kind: "unknown", reason: (error as Error).message };
    }
  }

  async lookup(idempotencyKey: string): Promise<CaptureOutcome | null> {
    const response = await fetch(`${this.baseUrl}/charges/${encodeURIComponent(idempotencyKey)}`);
    if (response.status === 404) {
      return null;
    }
    return (await response.json()) as CaptureOutcome;
  }
}
