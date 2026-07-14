import { Body, Controller, Get, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { Public } from "../../common/public.decorator";
import {
  createSessionCookieValue,
  SESSION_TTL_MS,
  shouldUseSecureSessionCookie,
} from "../../common/session-cookie";
import { AuthService } from "./auth.service";
import { ChangePasswordDto, LoginDto, UpdateProfileDto } from "./auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @Public()
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, sessionVersion } = await this.authService.validateLogin(
      body.username,
      body.password,
      req.ip || req.socket.remoteAddress || "unknown",
    );
    res.cookie(
      "liveboard_session",
      createSessionCookieValue(user.id, sessionVersion),
      {
        httpOnly: true,
        maxAge: SESSION_TTL_MS,
        path: "/",
        sameSite: "lax",
        secure: shouldUseSecureSessionCookie(),
      },
    );

    return { user };
  }

  @Post("logout")
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie("liveboard_session", {
      path: "/",
      sameSite: "lax",
      secure: shouldUseSecureSessionCookie(),
    });
    return { ok: true };
  }

  @Get("me")
  async me(@CurrentUserId() userId: string | null) {
    return { user: await this.authService.getCurrentUser(userId) };
  }

  @Patch("me")
  async updateMe(
    @CurrentUserId() userId: string | null,
    @Body() body: UpdateProfileDto,
  ) {
    return { user: await this.authService.updateProfile(userId, body) };
  }

  @Patch("password")
  async changePassword(
    @CurrentUserId() userId: string | null,
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changePassword(userId, body);
    res.cookie(
      "liveboard_session",
      createSessionCookieValue(result.userId, result.sessionVersion),
      {
        httpOnly: true,
        maxAge: SESSION_TTL_MS,
        path: "/",
        sameSite: "lax",
        secure: shouldUseSecureSessionCookie(),
      },
    );
    return { ok: true };
  }
}
