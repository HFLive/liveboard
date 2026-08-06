import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { requireSuperAdmin } from "../../common/require-super-admin";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { ApiTokenService } from "./api-token.service";

class CreateApiTokenDto {
  @IsString()
  userId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

/** 个人访问令牌管理端点（走 cookie session，限最高管理员）。 */
@Controller()
export class ApiTokensController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiTokens: ApiTokenService,
  ) {}

  @Post("admin/api-tokens")
  async create(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateApiTokenDto,
  ) {
    await requireSuperAdmin(this.prisma, userId);
    const target = await this.prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true, status: true },
    });
    if (!target || target.status !== "active") {
      throw new BadRequestException("目标用户不存在或未启用");
    }
    return this.apiTokens.createToken({
      userId: body.userId,
      name: body.name,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
  }

  @Get("admin/api-tokens")
  async list(
    @CurrentUserId() userId: string | null,
    @Query("userId") targetUserId?: string,
  ) {
    await requireSuperAdmin(this.prisma, userId);
    return { tokens: await this.apiTokens.listTokens(targetUserId) };
  }

  @Delete("admin/api-tokens/:id")
  async revoke(
    @CurrentUserId() userId: string | null,
    @Param("id") tokenId: string,
  ) {
    await requireSuperAdmin(this.prisma, userId);
    await this.apiTokens.revokeToken(tokenId);
    return { ok: true };
  }
}
