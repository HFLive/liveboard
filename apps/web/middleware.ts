import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const HTTPS_SESSION_COOKIE = "liveboard_session";
const HTTP_SESSION_COOKIE = "liveboard_session_http";

// 与 lib/routes.ts 的 APP_ROUTES.classrooms 保持一致。
const APP_CLASSROOMS_URL = "/app/classrooms";

/**
 * 会话 Cookie 名由 API 端 SESSION_COOKIE_SECURE 决定，与中间件能观测到的
 * 协议信号（x-forwarded-proto / URL scheme）是两个独立来源，可能不一致
 * （例如 HTTPS 前置但 SESSION_COOKIE_SECURE 未设为 true）。因此这里
 * 协议无关地同时认两个名字；真正校验仍由 API 的 ActiveUserGuard 负责，
 * 中间件只做粗粒度的路由引导。
 */
function hasSessionCookie(request: NextRequest) {
  return (
    request.cookies.has(HTTPS_SESSION_COOKIE) ||
    request.cookies.has(HTTP_SESSION_COOKIE)
  );
}

export function middleware(request: NextRequest) {
  const hasSession = hasSessionCookie(request);
  const { pathname } = request.nextUrl;

  // 被 401 踢回的登录页（redirectToLoginOnUnauthorized 会带 reason 参数）
  // 说明刚发生会话失效，不要再把它弹回 /app，避免与死 cookie 形成跳转循环；
  // API 端 ActiveUserGuard 会同步清理失效 cookie 作为最终保障。
  const bouncedFromApp =
    pathname === "/login" && request.nextUrl.searchParams.has("reason");

  // 已登录用户打开首页或登录页：直接接入应用，避免「重开站点被要求重新登录」。
  if (
    hasSession &&
    (pathname === "/login" || pathname === "/") &&
    !bouncedFromApp
  ) {
    return NextResponse.redirect(new URL(APP_CLASSROOMS_URL, request.url));
  }

  // 未登录访问应用区：引导到登录页。
  if (pathname.startsWith("/app") && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/app/:path*", "/login"],
};
