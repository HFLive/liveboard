import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import { IsString, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { Public } from "../../common/public.decorator";
import {
  createSessionCookieValue,
  getSessionCookieName,
  SESSION_TTL_MS,
  shouldUseSecureSessionCookie,
} from "../../common/session-cookie";
import { HfliveAuthService } from "./hflive-auth.service";

class PasswordLinkDto {
  @IsString()
  ticket!: string;

  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

class LocalSessionLinkDto {
  @IsString()
  password!: string;

  @IsString()
  returnTo = "/app";
}

class AdminLinkDto {
  @IsString()
  @MinLength(1)
  subject!: string;
}

@Controller("auth")
export class HfliveAuthController {
  constructor(private readonly hflive: HfliveAuthService) {}

  @Get("config")
  @Public()
  config(@Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    return this.hflive.capabilities;
  }

  @Get("hflive/start")
  @Public()
  async start(
    @Query("returnTo") returnTo: string | undefined,
    @Res() res: Response,
  ) {
    const target = await this.hflive.begin({ returnTo });
    return res.redirect(302, target.href);
  }

  @Get("hflive/callback")
  @Public()
  async callback(
    @Query("state") state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const configured = this.hflive.callbackUrl(req.originalUrl);
    try {
      const result = await this.hflive.complete(configured, state);
      setSessionCookie(res, result.user.id, result.sessionVersion);
      return res.redirect(302, result.returnTo);
    } catch (caught) {
      const ticket = accountLinkTicket(caught);
      res.setHeader("Cache-Control", "private, no-store");
      return res.redirect(
        302,
        ticket
          ? this.hflive.accountLinkPageUrl(ticket)
          : this.hflive.loginErrorPageUrl(),
      );
    }
  }

  @Get("hflive/account")
  account(
    @CurrentUserId() userId: string | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    return this.hflive.accountContext(userId);
  }

  @Post("hflive/link/password")
  @Public()
  async linkPassword(
    @Body() body: PasswordLinkDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.hflive.linkWithPassword(body);
    setSessionCookie(res, result.user.id, result.sessionVersion);
    return { user: result.user };
  }

  @Post("hflive/link/start")
  async linkStart(
    @CurrentUserId() userId: string | null,
    @Body() body: LocalSessionLinkDto,
  ) {
    const target = await this.hflive.beginLocalSessionLink(
      userId,
      body.password,
      body.returnTo,
    );
    return { authorizationUrl: target.href };
  }
}

function accountLinkTicket(caught: unknown) {
  if (!(caught instanceof HttpException) || caught.getStatus() !== 409) {
    return null;
  }
  const response = caught.getResponse();
  if (!response || typeof response !== "object") return null;
  const value = response as Record<string, unknown>;
  return value.error === "ACCOUNT_LINK_REQUIRED" &&
    typeof value.conflictTicket === "string"
    ? value.conflictTicket
    : null;
}

@Controller("admin/users")
export class HfliveAdminController {
  constructor(private readonly hflive: HfliveAuthService) {}

  @Post(":id/hflive-link")
  link(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") targetUserId: string,
    @Body() body: AdminLinkDto,
  ) {
    return this.hflive.adminLink(actorUserId, targetUserId, body.subject);
  }

  @Get(":id/hflive-identity")
  status(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") targetUserId: string,
  ) {
    return this.hflive.adminIdentityStatus(actorUserId, targetUserId);
  }

  @Post(":id/hflive-sync")
  sync(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") targetUserId: string,
  ) {
    return this.hflive.adminSyncIdentity(actorUserId, targetUserId);
  }
}

@Controller("internal/hflive")
export class HfliveWebhookController {
  constructor(private readonly hflive: HfliveAuthService) {}

  @Post("events")
  @Public()
  @HttpCode(204)
  async event(
    @Body() body: Buffer,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const outcome = await this.hflive.processWebhook(body, headers);
    // retryable 返回 503（非 2xx）：live_sso outbox 只会把非 2xx 当失败重试，
    // 终态（applied/duplicate/ignored）一律 204，避免无效重试耗尽进死信。
    if (outcome.kind === "retryable") {
      throw new ServiceUnavailableException("HFLive webhook retry required");
    }
  }
}

function setSessionCookie(
  res: Response,
  userId: string,
  sessionVersion: number,
) {
  const secure = shouldUseSecureSessionCookie();
  res.cookie(
    getSessionCookieName(secure),
    createSessionCookieValue(userId, sessionVersion),
    {
      httpOnly: true,
      maxAge: SESSION_TTL_MS,
      path: "/",
      sameSite: "lax",
      secure,
    },
  );
}
