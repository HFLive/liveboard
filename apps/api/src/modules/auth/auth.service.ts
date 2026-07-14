import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { UserSummary } from "@liveboard/shared";
import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { ChangePasswordDto, UpdateProfileDto } from "./auth.dto";
import { LoginRateLimitService } from "./login-rate-limit.service";

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash = argon2.hash(randomUUID());
  constructor(
    private readonly prisma: PrismaService,
    private readonly loginRateLimit: LoginRateLimitService,
  ) {}

  async validateLogin(
    username: string,
    password: string,
    clientAddress = "unknown",
  ): Promise<{ user: UserSummary; sessionVersion: number }> {
    const normalizedUsername = username.trim();
    if (
      await this.loginRateLimit.isBlocked(clientAddress, normalizedUsername)
    ) {
      throw new HttpException(
        "登录尝试过多，请稍后再试",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
    });
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? (await this.dummyPasswordHash),
      password,
    );

    if (!user || user.status !== "active" || !passwordMatches) {
      await this.loginRateLimit.recordFailure(
        clientAddress,
        normalizedUsername,
      );
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.loginRateLimit.clear(clientAddress, normalizedUsername);
    return { user: this.toSummary(user), sessionVersion: user.sessionVersion };
  }

  async getCurrentUser(userId: string | null): Promise<UserSummary> {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.status !== "active") {
      throw new NotFoundException("User not found");
    }

    return this.toSummary(user);
  }

  async updateProfile(
    userId: string | null,
    input: UpdateProfileDto,
  ): Promise<UserSummary> {
    const user = await this.requireActiveUser(userId);
    const displayName = input.displayName.trim();

    if (!displayName) {
      throw new BadRequestException("显示名不能为空");
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { displayName },
    });

    return this.toSummary(updated);
  }

  async changePassword(userId: string | null, input: ChangePasswordDto) {
    const user = await this.requireActiveUser(userId);
    const passwordMatches = await argon2.verify(
      user.passwordHash,
      input.currentPassword,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException("当前密码不正确");
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(input.newPassword),
        sessionVersion: { increment: 1 },
      },
      select: { id: true, sessionVersion: true },
    });

    return { userId: updated.id, sessionVersion: updated.sessionVersion };
  }

  private async requireActiveUser(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.status !== "active") {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  private toSummary(user: {
    id: string;
    username: string;
    displayName: string;
    systemRole: UserSummary["systemRole"];
    status: UserSummary["status"];
  }): UserSummary {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      systemRole: user.systemRole,
      status: user.status,
    };
  }
}
