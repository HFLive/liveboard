import {
  createSessionCookieValue,
  getSessionCookieName,
  HTTP_SESSION_COOKIE_NAME,
  HTTPS_SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  shouldUseSecureSessionCookie,
  verifySessionCookies,
  verifySessionCookieValue,
} from "./session-cookie";

describe("session cookie", () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecureSetting = process.env.SESSION_COOKIE_SECURE;

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret-with-sufficient-length";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    restoreEnvironmentVariable("SESSION_SECRET", originalSecret);
    restoreEnvironmentVariable("NODE_ENV", originalNodeEnv);
    restoreEnvironmentVariable("SESSION_COOKIE_SECURE", originalSecureSetting);
    jest.useRealTimers();
  });

  it("accepts a valid signed session", () => {
    const value = createSessionCookieValue("user-1", 3);

    expect(verifySessionCookieValue(value)).toEqual({
      userId: "user-1",
      sessionVersion: 3,
    });
  });

  it("rejects a modified session", () => {
    const value = createSessionCookieValue("user-1", 3);

    expect(
      verifySessionCookieValue(value.replace("user-1", "user-2")),
    ).toBeNull();
  });

  it("rejects the retired v1 session format", () => {
    expect(verifySessionCookieValue("v1.user-1.signature")).toBeNull();
  });

  it("rejects the retired v2 session format", () => {
    expect(verifySessionCookieValue("v2.user-1.123.signature")).toBeNull();
  });

  it("rejects a session after its server-side expiry", () => {
    const value = createSessionCookieValue("user-1", 3);
    jest.advanceTimersByTime(SESSION_TTL_MS + 1);

    expect(verifySessionCookieValue(value)).toBeNull();
  });

  it("uses secure cookies by default in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_COOKIE_SECURE;

    expect(shouldUseSecureSessionCookie()).toBe(true);
  });

  it("allows an explicit insecure cookie for HTTP-only deployments", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_COOKIE_SECURE = "false";

    expect(shouldUseSecureSessionCookie()).toBe(false);
  });

  it("allows secure cookies to be forced outside production", () => {
    process.env.NODE_ENV = "development";
    process.env.SESSION_COOKIE_SECURE = "true";

    expect(shouldUseSecureSessionCookie()).toBe(true);
  });

  it("uses different cookie names for HTTPS and HTTP", () => {
    expect(getSessionCookieName(true)).toBe(HTTPS_SESSION_COOKIE_NAME);
    expect(getSessionCookieName(false)).toBe(HTTP_SESSION_COOKIE_NAME);
  });

  it("accepts the HTTP cookie after downgrading from HTTPS", () => {
    const httpSession = createSessionCookieValue("http-user", 2);

    expect(
      verifySessionCookies({ [HTTP_SESSION_COOKIE_NAME]: httpSession }, false),
    ).toEqual({
      userId: "http-user",
      sessionVersion: 2,
    });
  });

  it("keeps accepting the legacy cookie for existing HTTP sessions", () => {
    const legacySession = createSessionCookieValue("legacy-user", 1);

    expect(
      verifySessionCookies(
        { [HTTPS_SESSION_COOKIE_NAME]: legacySession },
        false,
      ),
    ).toEqual({
      userId: "legacy-user",
      sessionVersion: 1,
    });
  });

  it("does not accept an HTTP-only cookie while HTTPS is enabled", () => {
    const httpSession = createSessionCookieValue("http-user", 2);

    expect(
      verifySessionCookies({ [HTTP_SESSION_COOKIE_NAME]: httpSession }, true),
    ).toBeNull();
  });
});

function restoreEnvironmentVariable(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
