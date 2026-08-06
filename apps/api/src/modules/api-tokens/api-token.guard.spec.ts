import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest } from "../../common/active-user.guard";
import { ApiTokenGuard } from "./api-token.guard";
import { ApiTokenService } from "./api-token.service";

describe("ApiTokenGuard", () => {
  const apiTokens = { authenticate: jest.fn() };
  const request: Partial<AuthenticatedRequest & { auth?: unknown }> = {
    headers: {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  let guard: ApiTokenGuard;

  beforeEach(() => {
    jest.resetAllMocks();
    request.headers = {};
    delete request.currentUserId;
    delete request.auth;
    guard = new ApiTokenGuard(apiTokens as unknown as ApiTokenService);
  });

  it("rejects a request without an Authorization header", async () => {
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects a non-Bearer header", async () => {
    request.headers = { authorization: "Basic abc123" };

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(apiTokens.authenticate).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", async () => {
    request.headers = { authorization: "Bearer lbt_bad-token" };
    apiTokens.authenticate.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.currentUserId).toBeUndefined();
  });

  it("attaches the token identity to the request", async () => {
    request.headers = { authorization: "Bearer lbt_valid-token" };
    apiTokens.authenticate.mockResolvedValue({
      userId: "user-1",
      tokenId: "tok-1",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.currentUserId).toBe("user-1");
    expect(request.auth).toEqual({ userId: "user-1", tokenId: "tok-1" });
    expect(apiTokens.authenticate).toHaveBeenCalledWith("lbt_valid-token");
  });
});
