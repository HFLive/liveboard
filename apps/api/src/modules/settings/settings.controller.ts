import { Body, Controller, Get, Patch } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { Public } from "../../common/public.decorator";
import { SettingsService } from "./settings.service";

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
}
