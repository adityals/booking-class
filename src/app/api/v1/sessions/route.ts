import { getPool } from "@/src/infra/db/pool";
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
  const username = String(form.get("username") ?? "").trim();
  if (!username) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const result = await getPool().query<{ id: string }>(
    "SELECT id FROM parents WHERE username = $1",
    [username],
  );
  const id = result.rows[0] ? Number(result.rows[0].id) : 0;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/classes", request.url), 303);
  response.cookies.set(SESSION_COOKIE, await signSession({ kind: "parent", parentId: id }), cookieOptions);
  return response;
}

export async function DELETE(request: Request): Promise<Response> {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
