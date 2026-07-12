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

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash = argon2.hash(randomUUID());
  private readonly loginAttempts = new Map<
    string,
    { count: number; windowStartedAt: number; blockedUntil: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async validateLogin(
    username: string,
    password: string,
    clientAddress = "unknown",
  ): Promise<UserSummary> {
    const normalizedUsername = username.trim();
    const attemptKey = `${clientAddress}:${normalizedUsername.toLowerCase()}`;
    this.assertLoginAllowed(attemptKey);

    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
    });
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? (await this.dummyPasswordHash),
      password,
    );

    if (!user || user.status !== "active" || !passwordMatches) {
      this.recordFailedLogin(attemptKey);
      throw new UnauthorizedException("Invalid credentials");
    }

    this.loginAttempts.delete(attemptKey);
    return this.toSummary(user);
  }

  private assertLoginAllowed(key: string) {
    const attempt = this.loginAttempts.get(key);

    if (!attempt) {
      return;
    }

    if (attempt.blockedUntil > Date.now()) {
      throw new HttpException(
        "登录尝试过多，请稍后再试",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (Date.now() - attempt.windowStartedAt >= 15 * 60 * 1000) {
      this.loginAttempts.delete(key);
    }
  }

  private recordFailedLogin(key: string) {
    const now = Date.now();
    const previous = this.loginAttempts.get(key);
    const withinWindow = Boolean(
      previous && now - previous.windowStartedAt < 15 * 60 * 1000,
    );
    const count = withinWindow && previous ? previous.count + 1 : 1;

    this.loginAttempts.set(key, {
      count,
      windowStartedAt:
        withinWindow && previous ? previous.windowStartedAt : now,
      blockedUntil: count >= 8 ? now + 15 * 60 * 1000 : 0,
    });

    if (this.loginAttempts.size > 1000) {
      for (const [attemptKey, attempt] of this.loginAttempts) {
        if (now - attempt.windowStartedAt >= 15 * 60 * 1000) {
          this.loginAttempts.delete(attemptKey);
        }
      }
    }
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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(input.newPassword) },
    });
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
