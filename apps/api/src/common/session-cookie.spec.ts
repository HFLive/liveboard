import {
  createSessionCookieValue,
  SESSION_TTL_MS,
  verifySessionCookieValue,
} from "./session-cookie";

describe("session cookie", () => {
  const originalSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret-with-sufficient-length";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
    jest.useRealTimers();
  });

  it("accepts a valid signed session", () => {
    const value = createSessionCookieValue("user-1");

    expect(verifySessionCookieValue(value)).toBe("user-1");
  });

  it("rejects a modified session", () => {
    const value = createSessionCookieValue("user-1");

    expect(
      verifySessionCookieValue(value.replace("user-1", "user-2")),
    ).toBeNull();
  });

  it("rejects the retired v1 session format", () => {
    expect(verifySessionCookieValue("v1.user-1.signature")).toBeNull();
  });

  it("rejects a session after its server-side expiry", () => {
    const value = createSessionCookieValue("user-1");
    jest.advanceTimersByTime(SESSION_TTL_MS + 1);

    expect(verifySessionCookieValue(value)).toBeNull();
  });
});
