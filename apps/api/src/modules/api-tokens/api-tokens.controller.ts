import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
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
import {
  isSuperAdmin,
  isSystemAdmin,
  type SystemRole,
} from "@liveboard/shared";
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

/**
 * 个人访问令牌管理端点（走 cookie session，限系统管理员）。
 * 普通管理员只能管理自己的令牌；最高管理员可管理全部成员令牌。
 */
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
    const actor = await this.requireAdmin(userId);
    // 普通管理员只能以自己的身份创建令牌
    const targetUserId = isSuperAdmin(actor.systemRole)
      ? body.userId
      : actor.id;
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });
    if (!target || target.status !== "active") {
      throw new BadRequestException("目标用户不存在或未启用");
    }
    return this.apiTokens.createToken({
      userId: targetUserId,
      name: body.name,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
  }

  @Get("admin/api-tokens")
  async list(
    @CurrentUserId() userId: string | null,
    @Query("userId") targetUserId?: string,
  ) {
    const actor = await this.requireAdmin(userId);
    // 普通管理员只能查看自己的令牌
    const effectiveTargetUserId = isSuperAdmin(actor.systemRole)
      ? targetUserId
      : actor.id;
    return {
      tokens: await this.apiTokens.listTokens(effectiveTargetUserId),
    };
  }

  /** 校验令牌存在且（非最高管理员时）归属当前用户。 */
  private async requireOwnedToken(
    actor: { id: string; systemRole: SystemRole },
    tokenId: string,
  ) {
    const token = await this.prisma.apiToken.findUnique({
      where: { id: tokenId },
      select: { userId: true },
    });
    if (!token) throw new NotFoundException("令牌不存在");
    if (!isSuperAdmin(actor.systemRole) && token.userId !== actor.id) {
      throw new ForbiddenException("只能管理自己的令牌");
    }
    return token;
  }

  @Post("admin/api-tokens/:id/revoke")
  async revoke(
    @CurrentUserId() userId: string | null,
    @Param("id") tokenId: string,
  ) {
    const actor = await this.requireAdmin(userId);
    await this.requireOwnedToken(actor, tokenId);
    await this.apiTokens.revokeToken(tokenId);
    return { ok: true };
  }

  @Post("admin/api-tokens/:id/restore")
  async restore(
    @CurrentUserId() userId: string | null,
    @Param("id") tokenId: string,
  ) {
    const actor = await this.requireAdmin(userId);
    await this.requireOwnedToken(actor, tokenId);
    await this.apiTokens.restoreToken(tokenId);
    return { ok: true };
  }

  @Delete("admin/api-tokens/:id")
  async remove(
    @CurrentUserId() userId: string | null,
    @Param("id") tokenId: string,
  ) {
    const actor = await this.requireAdmin(userId);
    await this.requireOwnedToken(actor, tokenId);
    await this.apiTokens.deleteToken(tokenId);
    return { ok: true };
  }
}
