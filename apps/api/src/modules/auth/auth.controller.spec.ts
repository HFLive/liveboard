import type { Request, Response } from "express";
import {
  PRIVATE_IMMUTABLE_CACHE_CONTROL,
  PRIVATE_NO_STORE_CACHE_CONTROL,
  PRIVATE_REVALIDATED_CACHE_CONTROL,
} from "../../common/cache-control";
import type { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";

describe("AuthController session cookies", () => {
  const originalSecureSetting = process.env.SESSION_COOKIE_SECURE;
  const originalSecret = process.env.SESSION_SECRET;
  const authService = {
    getAvatar: jest.fn(),
    getBanner: jest.fn(),
    validateLogin: jest.fn(),
  };
  const request = {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  } as Request;
  const response = {
    clearCookie: jest.fn(),
    cookie: jest.fn(),
    redirect: jest.fn(),
    setHeader: jest.fn(),
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

  it.each([
    ["avatar", "getAvatar"],
    ["banner", "getBanner"],
  ] as const)(
    "uses immutable caching only for versioned %s URLs",
    async (resource, serviceMethod) => {
      const stream = { pipe: jest.fn() };
      authService[serviceMethod].mockResolvedValue({
        mimeType: "image/png",
        redirectUrl: null,
        stream,
      });

      if (resource === "avatar") {
        await controller.getAvatar("user-1", "user-1", response, "7");
      } else {
        await controller.getBanner("user-1", "user-1", response, "7");
      }

      expect(response.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        PRIVATE_IMMUTABLE_CACHE_CONTROL,
      );

      jest.mocked(response.setHeader).mockClear();
      if (resource === "avatar") {
        await controller.getAvatar("user-1", "user-1", response);
      } else {
        await controller.getBanner("user-1", "user-1", response);
      }
      expect(response.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        PRIVATE_REVALIDATED_CACHE_CONTROL,
      );
    },
  );

  it("does not cache a short-lived signed image redirect", async () => {
    authService.getAvatar.mockResolvedValue({
      mimeType: "image/png",
      redirectUrl: "https://r2.example/signed-avatar",
      stream: null,
    });

    await controller.getAvatar("user-1", "user-1", response, "7");

    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      PRIVATE_NO_STORE_CACHE_CONTROL,
    );
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      "https://r2.example/signed-avatar",
    );
    expect(response.setHeader).not.toHaveBeenCalledWith(
      "Cache-Control",
      PRIVATE_IMMUTABLE_CACHE_CONTROL,
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
