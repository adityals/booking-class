import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/src/auth/session";

export async function POST(request: Request): Promise<Response> {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
