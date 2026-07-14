import {
  createSessionCookieValue,
  SESSION_TTL_MS,
  shouldUseSecureSessionCookie,
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
});

function restoreEnvironmentVariable(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
