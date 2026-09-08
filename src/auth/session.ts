export type ParentSession = {
  kind: "parent";
  parentId: number;
};

export type AdminSession = {
  kind: "admin";
};

export type Session = ParentSession | AdminSession;

export const SESSION_COOKIE = "booking_session";

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.SESSION_SECRET || "dev-only-not-a-secret")
      .buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(session: Session): Promise<string> {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(),
    new TextEncoder().encode(payload).buffer as ArrayBuffer,
  );
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionValue(value: string): Promise<Session | null> {
  try {
    const parts = value.split(".");
    if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
      return null;
    }

    const payload = parts[0];
    const signature = decodeBase64Url(parts[1]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      await key(),
      signature.buffer as ArrayBuffer,
      new TextEncoder().encode(payload).buffer as ArrayBuffer,
    );

    if (!valid) {
      return null;
    }

    const parsed: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const candidate = parsed as { kind?: unknown; parentId?: unknown };
    if (candidate.kind === "admin") {
      return { kind: "admin" };
    }

    if (
      candidate.kind === "parent" &&
      typeof candidate.parentId === "number" &&
      Number.isSafeInteger(candidate.parentId) &&
      candidate.parentId > 0
    ) {
      return { kind: "parent", parentId: candidate.parentId };
    }

    return null;
  } catch {
    return null;
  }
}
