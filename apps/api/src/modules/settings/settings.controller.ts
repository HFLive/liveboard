import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IsOptional, IsString } from "class-validator";
import type { Response } from "express";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { Public } from "../../common/public.decorator";
import {
  MAX_FAVICON_SIZE_BYTES,
  SettingsService,
  type UploadedFaviconFile,
} from "./settings.service";

class UpdateSystemSettingsDto {
  @IsOptional()
  @IsString()
  timeZone?: string;
}

@Controller()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("settings/public")
  @Public()
  async publicSettings() {
    return { settings: await this.settingsService.getPublicSettings() };
  }

  @Get("settings/favicon")
  @Public()
  async favicon(@Res() response: Response) {
    const favicon = await this.settingsService.getFavicon();
    response.setHeader("Content-Type", favicon.mimeType);
    response.setHeader("Cache-Control", "public, max-age=3600");
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    response.setHeader("X-Content-Type-Options", "nosniff");
    favicon.stream.pipe(response);
  }

  @Get("admin/settings")
  async settings(@CurrentUserId() userId: string | null) {
    return { settings: await this.settingsService.getSettings(userId) };
  }

  @Patch("admin/settings")
  async updateSettings(
    @CurrentUserId() userId: string | null,
    @Body() body: UpdateSystemSettingsDto,
  ) {
    return {
      settings: await this.settingsService.updateSettings(userId, body),
    };
  }

  @Post("admin/settings/favicon")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_FAVICON_SIZE_BYTES, files: 1 },
    }),
  )
  async updateFavicon(
    @CurrentUserId() userId: string | null,
    @UploadedFile() file?: UploadedFaviconFile,
  ) {
    return {
      settings: await this.settingsService.updateFavicon(userId, file),
    };
  }

  @Delete("admin/settings/favicon")
  async resetFavicon(@CurrentUserId() userId: string | null) {
    return {
      settings: await this.settingsService.resetFavicon(userId),
    };
  }
}
