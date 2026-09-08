import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "./auth/session";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  if (path === "/login" || path === "/admin/login") {
    return NextResponse.next();
  }
  const adminArea =
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/v1/admin" ||
    path.startsWith("/api/v1/admin/") ||
    path === "/api/v1/internal" ||
    path.startsWith("/api/v1/internal/");
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  const session = value ? await verifySessionValue(value) : null;
  const allowed = adminArea ? session?.kind === "admin" : session?.kind === "parent";
  if (allowed) {
    return NextResponse.next();
  }

  const login = adminArea ? "/admin/login" : "/login";
  const url = request.nextUrl.clone();
  url.pathname = login;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/classes/:path*",
    "/bookings/:path*",
    "/api/v1/((?!sessions(?:/|$)|admin/sessions(?:/|$)).*)",
  ],
};
