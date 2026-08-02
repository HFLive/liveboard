import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import type { Response } from "express";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import {
  isVersionedResourceRequest,
  PUBLIC_IMMUTABLE_CACHE_CONTROL,
  PUBLIC_REVALIDATED_CACHE_CONTROL,
} from "../../common/cache-control";
import { Public } from "../../common/public.decorator";
import {
  MAX_FAVICON_SIZE_BYTES,
  parseFaviconVariant,
  SettingsService,
  type UploadedFaviconFile,
} from "./settings.service";

class UpdateSystemSettingsDto {
  @IsOptional()
  @IsString()
  timeZone?: string;
}

class EnableHttpsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  domain!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}

class DisableHttpsDto {
  @IsOptional()
  @IsString()
  @MaxLength(253)
  httpHost?: string;
}

class ConfigureHttpAccessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  primaryHost!: string;

  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  allowedHosts!: string[];
}

class UpdateHttpsRenewalDto {
  @IsBoolean()
  enabled!: boolean;
}

@Controller()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("settings/public")
  @Public()
  async publicSettings(@Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", PUBLIC_REVALIDATED_CACHE_CONTROL);
    return { settings: await this.settingsService.getPublicSettings() };
  }

  @Get("settings/favicon")
  @Public()
  async favicon(@Res() response: Response, @Query("v") version?: string) {
    const favicon = await this.settingsService.getFavicon();
    this.sendFavicon(response, favicon, version);
  }

  @Get("settings/favicon/:variant")
  @Public()
  async faviconVariant(
    @Param("variant") variant: string,
    @Res() response: Response,
    @Query("v") version?: string,
  ) {
    const favicon = await this.settingsService.getFavicon(
      parseFaviconVariant(variant),
    );
    this.sendFavicon(response, favicon, version);
  }

  private sendFavicon(
    response: Response,
    favicon: Awaited<ReturnType<SettingsService["getFavicon"]>>,
    version?: string,
  ) {
    response.setHeader(
      "Cache-Control",
      isVersionedResourceRequest(version)
        ? PUBLIC_IMMUTABLE_CACHE_CONTROL
        : PUBLIC_REVALIDATED_CACHE_CONTROL,
    );
    response.setHeader("Content-Type", favicon.mimeType);
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    response.setHeader("X-Content-Type-Options", "nosniff");
    favicon.stream!.pipe(response);
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

  @Post("admin/settings/favicon/:variant")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_FAVICON_SIZE_BYTES, files: 1 },
    }),
  )
  async updateFaviconVariant(
    @CurrentUserId() userId: string | null,
    @Param("variant") variant: string,
    @UploadedFile() file?: UploadedFaviconFile,
  ) {
    return {
      settings: await this.settingsService.updateFavicon(
        userId,
        file,
        parseFaviconVariant(variant),
      ),
    };
  }

  @Delete("admin/settings/favicon")
  async resetFavicon(@CurrentUserId() userId: string | null) {
    return {
      settings: await this.settingsService.resetFavicon(userId),
    };
  }

  @Delete("admin/settings/favicon/:variant")
  async resetFaviconVariant(
    @CurrentUserId() userId: string | null,
    @Param("variant") variant: string,
  ) {
    return {
      settings: await this.settingsService.resetFavicon(
        userId,
        parseFaviconVariant(variant),
      ),
    };
  }

  @Get("admin/settings/https")
  async httpsStatus(@CurrentUserId() userId: string | null) {
    return { https: await this.settingsService.getHttpsStatus(userId) };
  }

  @Post("admin/settings/https/enable")
  async enableHttps(
    @CurrentUserId() userId: string | null,
    @Body() body: EnableHttpsDto,
  ) {
    return {
      https: await this.settingsService.enableHttps(
        userId,
        body.domain,
        body.email,
      ),
    };
  }

  @Post("admin/settings/https/disable")
  async disableHttps(
    @CurrentUserId() userId: string | null,
    @Body() body: DisableHttpsDto,
  ) {
    return {
      https: await this.settingsService.disableHttps(userId, body.httpHost),
    };
  }

  @Patch("admin/settings/https/http-access")
  async configureHttpAccess(
    @CurrentUserId() userId: string | null,
    @Body() body: ConfigureHttpAccessDto,
  ) {
    return {
      https: await this.settingsService.configureHttpAccess(
        userId,
        body.primaryHost,
        body.allowedHosts,
      ),
    };
  }

  @Patch("admin/settings/https/auto-renew")
  async setHttpsAutoRenew(
    @CurrentUserId() userId: string | null,
    @Body() body: UpdateHttpsRenewalDto,
  ) {
    return {
      https: await this.settingsService.setHttpsAutoRenew(userId, body.enabled),
    };
  }
}
