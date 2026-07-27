import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const HTTPS_SESSION_COOKIE = "liveboard_session";
const HTTP_SESSION_COOKIE = "liveboard_session_http";

function requestUsesHttps(request: NextRequest) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();

  if (forwardedProtocol) {
    return forwardedProtocol === "https";
  }

  return request.nextUrl.protocol === "https:";
}

export function middleware(request: NextRequest) {
  const hasSession = requestUsesHttps(request)
    ? request.cookies.has(HTTPS_SESSION_COOKIE)
    : request.cookies.has(HTTP_SESSION_COOKIE) ||
      request.cookies.has(HTTPS_SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/app") && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/login"],
};
