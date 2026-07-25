import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type { BadgeColor } from "@liveboard/shared";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { BadgesService } from "./badges.service";

const BADGE_COLORS: BadgeColor[] = [
  "gold",
  "blue",
  "green",
  "purple",
  "red",
  "gray",
];

class CreateBadgeDto {
  @IsString()
  @MaxLength(20)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @IsIn(BADGE_COLORS)
  color!: BadgeColor;
}

class UpdateBadgeDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @IsOptional()
  @IsIn(BADGE_COLORS)
  color?: BadgeColor;
}

class SetEquippedBadgesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  badgeIds!: string[];
}

@Controller("badges")
export class BadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get("me")
  async listMine(@CurrentUserId() userId: string | null) {
    return { badges: await this.badgesService.listMine(userId) };
  }

  @Put("me/equipped")
  async setEquipped(
    @CurrentUserId() userId: string | null,
    @Body() body: SetEquippedBadgesDto,
  ) {
    return {
      badges: await this.badgesService.setEquipped(userId, body.badgeIds),
    };
  }
}

@Controller("admin/badges")
export class AdminBadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get()
  async list(@CurrentUserId() userId: string | null) {
    return { badges: await this.badgesService.listAdmin(userId) };
  }

  @Post()
  async create(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateBadgeDto,
  ) {
    return { badge: await this.badgesService.create(userId, body) };
  }

  @Patch(":badgeId")
  async update(
    @CurrentUserId() userId: string | null,
    @Param("badgeId") badgeId: string,
    @Body() body: UpdateBadgeDto,
  ) {
    return { badge: await this.badgesService.update(userId, badgeId, body) };
  }

  @Delete(":badgeId")
  async remove(
    @CurrentUserId() userId: string | null,
    @Param("badgeId") badgeId: string,
  ) {
    return this.badgesService.remove(userId, badgeId);
  }

  @Put(":badgeId/users/:targetUserId")
  async award(
    @CurrentUserId() userId: string | null,
    @Param("badgeId") badgeId: string,
    @Param("targetUserId") targetUserId: string,
  ) {
    return this.badgesService.award(userId, badgeId, targetUserId);
  }

  @Delete(":badgeId/users/:targetUserId")
  async revoke(
    @CurrentUserId() userId: string | null,
    @Param("badgeId") badgeId: string,
    @Param("targetUserId") targetUserId: string,
  ) {
    return this.badgesService.revoke(userId, badgeId, targetUserId);
  }
}
