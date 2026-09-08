import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PAYMENT_MOCK_PORT ?? process.env.PORT ?? 4001);
const configuredTimeout = Number(process.env.PAYMENT_TIMEOUT_MS ?? 5000);
const CLIENT_TIMEOUT_MS = Number.isFinite(configuredTimeout) ? configuredTimeout : 5000;
const TIMEOUT_DELAY_MS = Math.max(100, CLIENT_TIMEOUT_MS + 100);
const MEMO_FILE = join(__dirname, "memo.json");

type Mode = "ok" | "decline" | "timeout";
type Charge =
  | { status: "succeeded"; providerRef: string }
  | { status: "declined"; reason: string }
  | { status: "unknown"; reason: string };

type Memo = Record<string, Charge>;

let mode: Mode = "ok";

function isCharge(value: unknown): value is Charge {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("status" in value)) {
    return false;
  }
  const status = value.status;
  if (status === "succeeded") {
    return "providerRef" in value && typeof value.providerRef === "string";
  }
  if (status === "declined" || status === "unknown") {
    return "reason" in value && typeof value.reason === "string";
  }
  return false;
}

function loadMemo(): Memo {
  try {
    const parsed: unknown = JSON.parse(readFileSync(MEMO_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const loaded: Memo = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isCharge(value)) {
        loaded[key] = value;
      }
    }
    return loaded;
  } catch {
    return {};
  }
}

const memo: Memo = loadMemo();

function controlMode(value: unknown): Mode | null {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "mode" in value &&
    isMode(value.mode)
  ) {
    return value.mode;
  }
  return null;
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      if (body.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    request.on("error", reject);
  }
  return promise;
}

function persistMemo(): void {
  writeFileSync(MEMO_FILE, JSON.stringify(memo, null, 2));
}

function isMode(value: unknown): value is Mode {
  return value === "ok" || value === "decline" || value === "timeout";
}

function isChargeBody(value: unknown): value is { bookingId: number; amountCents: number } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("bookingId" in value) ||
    !("amountCents" in value)
  ) {
    return false;
  }
  return (
    typeof value.bookingId === "number" &&
    Number.isSafeInteger(value.bookingId) &&
    value.bookingId > 0 &&
    typeof value.amountCents === "number" &&
    Number.isSafeInteger(value.amountCents) &&
    value.amountCents >= 0
  );
}

function chargeStatus(charge: Charge): number {
  if (charge.status === "declined") {
    return 402;
  }
  if (charge.status === "unknown") {
    return 504;
  }
  return 200;
}

function createCharge(selectedMode: Mode): Charge {
  if (selectedMode === "decline") {
    return { status: "declined", reason: "payment_declined" };
  }
  if (selectedMode === "timeout") {
    return { status: "unknown", reason: "payment_timeout" };
  }
  return { status: "succeeded", providerRef: `charge_${randomUUID()}` };
}

async function handleCharge(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length === 0) {
    sendJson(response, 400, { error: "missing_idempotency_key" });
    return;
  }

  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    sendJson(response, 400, { error: "invalid_json" });
    return;
  }

  if (!isChargeBody(body)) {
    sendJson(response, 400, { error: "invalid_charge" });
    return;
  }

  const existing = memo[key];
  if (existing) {
    sendJson(response, 200, existing);
    return;
  }

  const forced = request.headers["x-force-payment"];
  const selectedMode = forced === undefined ? mode : forced;
  if (!isMode(selectedMode)) {
    sendJson(response, 400, { error: "invalid_payment_mode" });
    return;
  }

  const charge = createCharge(selectedMode);
  memo[key] = charge;
  persistMemo();
  if (charge.status === "unknown") {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, TIMEOUT_DELAY_MS);
    await promise;
  }
  sendJson(response, chargeStatus(charge), charge);
}

async function handleControl(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "GET") {
    sendJson(response, 200, { mode });
    return;
  }

  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    sendJson(response, 400, { error: "invalid_json" });
    return;
  }
  const selectedMode = controlMode(body);
  if (selectedMode === null) {
    sendJson(response, 400, { error: "invalid_mode" });
    return;
  }
  mode = selectedMode;
  sendJson(response, 200, { mode });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "POST" && url.pathname === "/charges") {
    await handleCharge(request, response);
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/charges/")) {
    const key = decodeURIComponent(url.pathname.slice("/charges/".length));
    const charge = memo[key];
    if (!charge) {
      sendJson(response, 404, { error: "charge_not_found" });
      return;
    }
    sendJson(response, 200, charge);
    return;
  }
  if (url.pathname === "/control" && (request.method === "GET" || request.method === "POST")) {
    await handleControl(request, response);
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    if (!response.headersSent) {
      sendJson(response, 500, { error: "internal_error" });
    } else {
      response.destroy();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Payment service mock listening on ${PORT}`);
});
