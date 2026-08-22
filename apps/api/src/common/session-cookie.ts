import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE_VERSION = "v3";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const HTTPS_SESSION_COOKIE_NAME = "liveboard_session";
export const HTTP_SESSION_COOKIE_NAME = "liveboard_session_http";
const DEFAULT_DEV_SECRET = "liveboard-dev-session-secret";

export function shouldUseSecureSessionCookie() {
  const configured = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();

  if (configured === "true") {
    return true;
  }

  if (configured === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

export function getSessionCookieName(secure = shouldUseSecureSessionCookie()) {
  return secure ? HTTPS_SESSION_COOKIE_NAME : HTTP_SESSION_COOKIE_NAME;
}

export function verifySessionCookies(
  cookies: Readonly<Record<string, string | undefined>> | undefined,
  secure = shouldUseSecureSessionCookie(),
) {
  const names = secure
    ? [HTTPS_SESSION_COOKIE_NAME]
    : [HTTP_SESSION_COOKIE_NAME, HTTPS_SESSION_COOKIE_NAME];

  for (const name of names) {
    const session = verifySessionCookieValue(cookies?.[name]);
    if (session) {
      return session;
    }
  }

  return null;
}

/**
 * 原生客户端无法可靠使用 HttpOnly Cookie，因此复用同一份 HMAC 会话值，
 * 通过 `Authorization: Bearer <sessionToken>` 提交。Web 继续只走 Cookie。
 */
export function verifySessionAuthorization(header: string | undefined) {
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? verifySessionCookieValue(match[1]) : null;
}

export const MOBILE_CLIENT_HEADER = "x-liveboard-client";
export const MOBILE_CLIENT_VALUE = "mobile";

export function isMobileClientRequest(headerValue: string | undefined) {
  return headerValue?.trim().toLowerCase() === MOBILE_CLIENT_VALUE;
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (
    process.env.NODE_ENV === "production" &&
    (!secret || secret === "replace-with-a-long-random-secret")
  ) {
    throw new Error("SESSION_SECRET must be configured in production");
  }

  return secret || DEFAULT_DEV_SECRET;
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

export interface SessionCookiePayload {
  userId: string;
  sessionVersion: number;
}

export function createSessionCookieValue(
  userId: string,
  sessionVersion: number,
) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${SESSION_COOKIE_VERSION}.${userId}.${sessionVersion}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionCookieValue(
  value: string | undefined,
): SessionCookiePayload | null {
  if (!value) {
    return null;
  }

  const parts = value.split(".");
  const [version, userId] = parts;

  const sessionVersion = Number(parts[2]);
  const expiresAt = Number(parts[3]);
  const signature = parts[4];

  if (
    parts.length !== 5 ||
    version !== SESSION_COOKIE_VERSION ||
    !userId ||
    !signature ||
    !Number.isSafeInteger(sessionVersion) ||
    sessionVersion < 0 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return null;
  }

  const payload = `${version}.${userId}.${sessionVersion}.${expiresAt}`;
  return hasValidSignature(payload, signature)
    ? { userId, sessionVersion }
    : null;
}

function hasValidSignature(payload: string, signature: string) {
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
