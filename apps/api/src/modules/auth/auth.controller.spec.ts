import type { Request, Response } from "express";
import type { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";

describe("AuthController session cookies", () => {
  const originalSecureSetting = process.env.SESSION_COOKIE_SECURE;
  const originalSecret = process.env.SESSION_SECRET;
  const authService = {
    validateLogin: jest.fn(),
  };
  const request = {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  } as Request;
  const response = {
    clearCookie: jest.fn(),
    cookie: jest.fn(),
  } as unknown as Response;
  let controller: AuthController;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.SESSION_SECRET = "test-session-secret-with-sufficient-length";
    authService.validateLogin.mockResolvedValue({
      sessionVersion: 3,
      user: { id: "user-1" },
    });
    controller = new AuthController(authService as unknown as AuthService);
  });

  afterEach(() => {
    restoreEnvironmentVariable("SESSION_COOKIE_SECURE", originalSecureSetting);
    restoreEnvironmentVariable("SESSION_SECRET", originalSecret);
  });

  it("sets a distinct non-secure cookie when HTTP mode is active", async () => {
    process.env.SESSION_COOKIE_SECURE = "false";

    await controller.login(
      { username: "admin", password: "password" },
      request,
      response,
    );

    expect(response.cookie).toHaveBeenCalledWith(
      "liveboard_session_http",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: false }),
    );
  });

  it("keeps the existing secure cookie name in HTTPS mode", async () => {
    process.env.SESSION_COOKIE_SECURE = "true";

    await controller.login(
      { username: "admin", password: "password" },
      request,
      response,
    );

    expect(response.cookie).toHaveBeenCalledWith(
      "liveboard_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: true }),
    );
  });
});

function restoreEnvironmentVariable(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
