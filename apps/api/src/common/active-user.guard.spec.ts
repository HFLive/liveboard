import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { PrismaService } from "../modules/prisma/prisma.service";
import type { MaintenanceService } from "../modules/maintenance/maintenance.service";
import {
  ActiveUserGuard,
  type AuthenticatedRequest,
} from "./active-user.guard";
import { createSessionCookieValue } from "./session-cookie";

describe("ActiveUserGuard", () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const prisma = { user: { findUnique: jest.fn() } };
  const maintenance = { isEnabled: jest.fn() };
  const request: Partial<AuthenticatedRequest> = { cookies: {}, method: "GET" };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  let guard: ActiveUserGuard;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.SESSION_SECRET = "test-session-secret-with-sufficient-length";
    process.env.SESSION_COOKIE_SECURE = "true";
    request.cookies = {};
    request.method = "GET";
    delete request.currentUserId;
    delete request.degradedSession;
    maintenance.isEnabled.mockResolvedValue(false);
    guard = new ActiveUserGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
      maintenance as unknown as MaintenanceService,
    );
  });

  it("does not require a session for explicitly public routes", async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["inactive", 4],
    ["active", 5],
  ])(
    "rejects a %s user with a mismatched session state",
    async (status, version) => {
      reflector.getAllAndOverride.mockReturnValue(false);
      request.cookies = {
        liveboard_session: createSessionCookieValue("user-1", 4),
      };
      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        status,
        sessionVersion: version,
      });

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(request.currentUserId).toBeUndefined();
    },
  );

  it("attaches the validated active user to the request", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    request.cookies = {
      liveboard_session: createSessionCookieValue("user-1", 4),
    };
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      status: "active",
      sessionVersion: 4,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.currentUserId).toBe("user-1");
  });

  it("accepts the separate HTTP cookie in HTTP mode", async () => {
    process.env.SESSION_COOKIE_SECURE = "false";
    reflector.getAllAndOverride.mockReturnValue(false);
    request.cookies = {
      liveboard_session_http: createSessionCookieValue("user-1", 4),
      liveboard_session: createSessionCookieValue("stale-https-user", 1),
    };
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      status: "active",
      sessionVersion: 4,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } }),
    );
  });

  it("does not accept the HTTP cookie in HTTPS mode", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    request.cookies = {
      liveboard_session_http: createSessionCookieValue("user-1", 4),
    };

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("degrades GET during maintenance when the DB is unavailable", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    request.cookies = {
      liveboard_session: createSessionCookieValue("user-1", 4),
    };
    request.method = "GET";
    maintenance.isEnabled.mockResolvedValue(true);
    prisma.user.findUnique.mockRejectedValue(
      Object.assign(new Error("table does not exist"), { code: "P2021" }),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.currentUserId).toBe("user-1");
    expect(request.degradedSession).toBe(true);
  });

  it("rejects non-GET writes during maintenance when the DB is unavailable", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    request.cookies = {
      liveboard_session: createSessionCookieValue("user-1", 4),
    };
    request.method = "POST";
    maintenance.isEnabled.mockResolvedValue(true);
    const dbError = Object.assign(new Error("table does not exist"), {
      code: "P2021",
    });
    prisma.user.findUnique.mockRejectedValue(dbError);

    await expect(guard.canActivate(context)).rejects.toThrow(/does not exist/);
    expect(request.currentUserId).toBeUndefined();
  });

  it("rethrows DB errors when maintenance is off", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    request.cookies = {
      liveboard_session: createSessionCookieValue("user-1", 4),
    };
    maintenance.isEnabled.mockResolvedValue(false);
    const dbError = Object.assign(new Error("table does not exist"), {
      code: "P2021",
    });
    prisma.user.findUnique.mockRejectedValue(dbError);

    await expect(guard.canActivate(context)).rejects.toThrow(/does not exist/);
    expect(request.currentUserId).toBeUndefined();
    expect(request.degradedSession).toBeUndefined();
  });
});
