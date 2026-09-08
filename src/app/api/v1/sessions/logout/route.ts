import { NextResponse } from "next/server";
import { getSession } from "@/src/auth/server";
import { SESSION_COOKIE } from "@/src/auth/session";

export async function POST(request: Request): Promise<Response> {
  // One logout for both principals: the cookie says which login page to land on.
  const session = await getSession();
  const login = session?.kind === "admin" ? "/admin/login" : "/login";

  const response = NextResponse.redirect(new URL(login, request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
