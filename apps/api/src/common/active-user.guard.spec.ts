import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { PrismaService } from "../modules/prisma/prisma.service";
import {
  ActiveUserGuard,
  type AuthenticatedRequest,
} from "./active-user.guard";
import { createSessionCookieValue } from "./session-cookie";

describe("ActiveUserGuard", () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const prisma = { user: { findUnique: jest.fn() } };
  const request: Partial<AuthenticatedRequest> = { cookies: {} };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  let guard: ActiveUserGuard;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.SESSION_SECRET = "test-session-secret-with-sufficient-length";
    request.cookies = {};
    delete request.currentUserId;
    guard = new ActiveUserGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
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
});
