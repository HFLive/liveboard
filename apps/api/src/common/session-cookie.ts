import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE_VERSION = "v2";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

export function createSessionCookieValue(userId: string) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${SESSION_COOKIE_VERSION}.${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionCookieValue(
  value: string | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const parts = value.split(".");
  const [version, userId] = parts;

  const expiresAt = Number(parts[2]);
  const signature = parts[3];

  if (
    parts.length !== 4 ||
    version !== SESSION_COOKIE_VERSION ||
    !userId ||
    !signature ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return null;
  }

  const payload = `${version}.${userId}.${expiresAt}`;
  return hasValidSignature(payload, signature) ? userId : null;
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
