import { SESSION_COOKIE, signSession } from "@/src/auth/session";
import { NextResponse } from "next/server";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");

  const expectedUsername = process.env.ADMIN_USERNAME || "admin";
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin";
  if (username !== expectedUsername || password !== expectedPassword) {
    return NextResponse.redirect(new URL("/admin/login", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set(
    SESSION_COOKIE,
    await signSession({ kind: "admin" }),
    cookieOptions,
  );
  return response;
}
