import { HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  HfliveAuthController,
  HfliveWebhookController,
} from "./hflive-auth.controller";
import type { HfliveAuthService } from "./hflive-auth.service";
import { ServiceUnavailableException } from "@nestjs/common";

describe("HfliveAuthController callback UX", () => {
  const hflive = {
    callbackUrl: jest.fn(() => new URL("https://board.example/callback")),
    complete: jest.fn(),
    accountLinkPageUrl: jest.fn(
      () => "https://board.example/login/link#ticket=opaque-ticket",
    ),
    loginErrorPageUrl: jest.fn(
      () => "https://board.example/login?reason=hflive-failed",
    ),
  };
  const response = {
    redirect: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response;
  const request = {
    originalUrl: "/auth/hflive/callback?state=state-1&code=redacted",
  } as Request;
  let controller: HfliveAuthController;

  beforeEach(() => {
    jest.resetAllMocks();
    hflive.callbackUrl.mockReturnValue(
      new URL("https://board.example/callback"),
    );
    hflive.accountLinkPageUrl.mockReturnValue(
      "https://board.example/login/link#ticket=opaque-ticket",
    );
    hflive.loginErrorPageUrl.mockReturnValue(
      "https://board.example/login?reason=hflive-failed",
    );
    controller = new HfliveAuthController(
      hflive as unknown as HfliveAuthService,
    );
  });

  it("redirects a profile conflict to a fragment-only one-time ticket", async () => {
    hflive.complete.mockRejectedValue(
      new HttpException(
        {
          statusCode: 409,
          error: "ACCOUNT_LINK_REQUIRED",
          conflictTicket: "opaque-ticket",
        },
        HttpStatus.CONFLICT,
      ),
    );

    await controller.callback("state-1", request, response);

    expect(hflive.accountLinkPageUrl).toHaveBeenCalledWith("opaque-ticket");
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store",
    );
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      "https://board.example/login/link#ticket=opaque-ticket",
    );
  });

  it("returns other callback failures to a generic retry state", async () => {
    hflive.complete.mockRejectedValue(
      new HttpException("OIDC response rejected", HttpStatus.UNAUTHORIZED),
    );

    await controller.callback("state-1", request, response);

    expect(response.redirect).toHaveBeenCalledWith(
      302,
      "https://board.example/login?reason=hflive-failed",
    );
  });
});

describe("HfliveWebhookController delivery semantics", () => {
  const hflive = { processWebhook: jest.fn() };
  let controller: HfliveWebhookController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new HfliveWebhookController(
      hflive as unknown as HfliveAuthService,
    );
  });

  it("maps a retryable outcome to 503 so the outbox retries", async () => {
    hflive.processWebhook.mockResolvedValue({ kind: "retryable" });
    await expect(
      controller.event(Buffer.from("{}"), {}),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("acknowledges terminal outcomes with 204", async () => {
    hflive.processWebhook.mockResolvedValue({ kind: "applied" });
    await expect(
      controller.event(Buffer.from("{}"), {}),
    ).resolves.toBeUndefined();
    hflive.processWebhook.mockResolvedValue({ kind: "duplicate" });
    await expect(
      controller.event(Buffer.from("{}"), {}),
    ).resolves.toBeUndefined();
    hflive.processWebhook.mockResolvedValue({
      kind: "ignored",
      reason: "HFLIVE_DISABLED",
    });
    await expect(
      controller.event(Buffer.from("{}"), {}),
    ).resolves.toBeUndefined();
  });
});
