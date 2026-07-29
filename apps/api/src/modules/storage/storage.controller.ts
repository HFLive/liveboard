import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { StorageService } from "./storage.service";

class OssSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(63)
  bucket?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  endpoint?: string;

  @IsOptional()
  @IsBoolean()
  internal?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  internalEndpoint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  accessKeyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  accessKeySecret?: string;
}

class UpdateStorageSettingsDto {
  @IsOptional()
  @IsIn(["minio", "oss"])
  backend?: string;

  @IsOptional()
  @IsIn(["proxy", "direct"])
  downloadMode?: string;

  @IsOptional()
  @IsIn(["relay", "direct"])
  uploadMode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OssSettingsDto)
  oss?: OssSettingsDto;
}

@Controller("admin/settings/storage")
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get()
  async getSettings(@CurrentUserId() userId: string | null) {
    return { storage: await this.storageService.getSettingsForAdmin(userId) };
  }

  @Put()
  async updateSettings(
    @CurrentUserId() userId: string | null,
    @Body() body: UpdateStorageSettingsDto,
  ) {
    return { storage: await this.storageService.updateSettings(userId, body) };
  }

  @Post("test")
  async testConnection(
    @CurrentUserId() userId: string | null,
    @Body() body: OssSettingsDto,
  ) {
    return this.storageService.testConnection(userId, body);
  }
}
