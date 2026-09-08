import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  type AdminSession,
  type ParentSession,
  type Session,
  verifySessionValue,
} from "./session";

export async function getSession(): Promise<Session | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) {
    return null;
  }
  return verifySessionValue(value);
}

export async function requireParent(): Promise<ParentSession> {
  const session = await getSession();
  if (!session || session.kind !== "parent") {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireAdmin(): Promise<AdminSession> {
  const session = await getSession();
  if (!session || session.kind !== "admin") {
    throw new Error("Unauthorized");
  }
  return session;
}
