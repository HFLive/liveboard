import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import {
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { isSystemAdmin } from "@liveboard/shared";
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

/** 个人访问令牌管理端点（走 cookie session，限系统管理员）。 */
@Controller()
export class ApiTokensController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiTokens: ApiTokenService,
  ) {}

  private async requireAdmin(userId: string | null) {
    if (!userId) throw new UnauthorizedException("缺少登录会话");
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, systemRole: true, status: true },
    });
    if (!user || !isSystemAdmin(user.systemRole) || user.status !== "active") {
      throw new ForbiddenException("只有管理员可以管理访问令牌");
    }
    return user;
  }

  @Post("admin/api-tokens")
  async create(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateApiTokenDto,
  ) {
    await this.requireAdmin(userId);
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
    await this.requireAdmin(userId);
    return { tokens: await this.apiTokens.listTokens(targetUserId) };
  }

  @Delete("admin/api-tokens/:id")
  async revoke(
    @CurrentUserId() userId: string | null,
    @Param("id") tokenId: string,
  ) {
    await this.requireAdmin(userId);
    await this.apiTokens.revokeToken(tokenId);
    return { ok: true };
  }
}
