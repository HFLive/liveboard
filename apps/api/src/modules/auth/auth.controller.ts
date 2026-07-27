import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { Public } from "../../common/public.decorator";
import {
  createSessionCookieValue,
  getSessionCookieName,
  HTTP_SESSION_COOKIE_NAME,
  HTTPS_SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  shouldUseSecureSessionCookie,
} from "../../common/session-cookie";
import { AuthService } from "./auth.service";
import {
  MAX_AVATAR_SIZE_BYTES,
  MAX_BANNER_SIZE_BYTES,
  type UploadedProfileImageFile,
} from "./auth.service";
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
    const secure = shouldUseSecureSessionCookie();
    res.cookie(
      getSessionCookieName(secure),
      createSessionCookieValue(user.id, sessionVersion),
      {
        httpOnly: true,
        maxAge: SESSION_TTL_MS,
        path: "/",
        sameSite: "lax",
        secure,
      },
    );

    return { user };
  }

  @Post("logout")
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    const secure = shouldUseSecureSessionCookie();
    res.clearCookie(getSessionCookieName(secure), {
      path: "/",
      sameSite: "lax",
      secure,
    });
    res.clearCookie(
      secure ? HTTP_SESSION_COOKIE_NAME : HTTPS_SESSION_COOKIE_NAME,
      {
        path: "/",
        sameSite: "lax",
        secure: false,
      },
    );
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

  @Post("me/avatar")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_AVATAR_SIZE_BYTES, files: 1 },
    }),
  )
  async updateAvatar(
    @CurrentUserId() userId: string | null,
    @UploadedFile() file?: UploadedProfileImageFile,
  ) {
    return { user: await this.authService.updateAvatar(userId, file) };
  }

  @Post("me/banner")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_BANNER_SIZE_BYTES, files: 1 },
    }),
  )
  async updateBanner(
    @CurrentUserId() userId: string | null,
    @UploadedFile() file?: UploadedProfileImageFile,
  ) {
    return { user: await this.authService.updateBanner(userId, file) };
  }

  @Get("profile/:id")
  async getProfile(
    @CurrentUserId() userId: string | null,
    @Param("id") targetUserId: string,
  ) {
    return {
      user: await this.authService.getUserProfile(userId, targetUserId),
    };
  }

  @Get("profile/:id/activity")
  async getProfileActivity(
    @CurrentUserId() userId: string | null,
    @Param("id") targetUserId: string,
  ) {
    return this.authService.getUserPublicActivity(userId, targetUserId);
  }

  @Get("avatar/:id")
  async getAvatar(
    @CurrentUserId() userId: string | null,
    @Param("id") targetUserId: string,
    @Res() res: Response,
  ) {
    const { mimeType, stream, redirectUrl } = await this.authService.getAvatar(
      userId,
      targetUserId,
    );

    if (redirectUrl) {
      res.redirect(302, redirectUrl);
      return;
    }
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    stream!.pipe(res);
  }

  @Get("banner/:id")
  async getBanner(
    @CurrentUserId() userId: string | null,
    @Param("id") targetUserId: string,
    @Res() res: Response,
  ) {
    const { mimeType, stream, redirectUrl } = await this.authService.getBanner(
      userId,
      targetUserId,
    );

    if (redirectUrl) {
      res.redirect(302, redirectUrl);
      return;
    }
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    stream!.pipe(res);
  }

  @Patch("password")
  async changePassword(
    @CurrentUserId() userId: string | null,
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changePassword(userId, body);
    const secure = shouldUseSecureSessionCookie();
    res.cookie(
      getSessionCookieName(secure),
      createSessionCookieValue(result.userId, result.sessionVersion),
      {
        httpOnly: true,
        maxAge: SESSION_TTL_MS,
        path: "/",
        sameSite: "lax",
        secure,
      },
    );
    return { ok: true };
  }
}
