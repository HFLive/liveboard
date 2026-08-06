import { createHash, randomBytes } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 个人访问令牌（PAT）：MCP 等外部客户端以用户身份调用 API。
 * 只存 SHA-256 哈希，明文仅在创建时返回一次。
 */

export const API_TOKEN_PREFIX = "lbt_";
/** lastUsedAt 写库节流窗口：窗口内不重复更新，减少每请求一次 DB 写。 */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export interface ApiTokenIdentity {
  userId: string;
  tokenId: string;
}

export interface CreateApiTokenInput {
  userId: string;
  name: string;
  expiresAt?: Date;
}

export interface ApiTokenView {
  id: string;
  name: string;
  userId: string;
  username: string;
  tokenPrefix: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

@Injectable()
export class ApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** 纯函数：raw token → SHA-256 hex。 */
  hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  /** 生成令牌，明文只通过返回值暴露一次（不落库、不打日志）。 */
  async createToken(input: CreateApiTokenInput): Promise<{
    token: string;
    tokenId: string;
    tokenPrefix: string;
  }> {
    const raw = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const record = await this.prisma.apiToken.create({
      data: {
        userId: input.userId,
        name: input.name,
        tokenHash: this.hashToken(raw),
        tokenPrefix: raw.slice(0, 10),
        expiresAt: input.expiresAt,
      },
      select: { id: true },
    });
    return { token: raw, tokenId: record.id, tokenPrefix: raw.slice(0, 10) };
  }

  /** 管理端列表（不含 tokenHash）。 */
  async listTokens(userId?: string): Promise<ApiTokenView[]> {
    const rows = await this.prisma.apiToken.findMany({
      where: userId ? { userId } : undefined,
      select: {
        id: true,
        name: true,
        userId: true,
        tokenPrefix: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        user: { select: { username: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    return rows.map(({ user, ...rest }) => ({
      ...rest,
      username: user.username,
    }));
  }

  /** 撤销 = 置 revokedAt（幂等）；令牌不存在返回 404。 */
  async revokeToken(tokenId: string): Promise<void> {
    try {
      await this.prisma.apiToken.update({
        where: { id: tokenId },
        data: { revokedAt: new Date() },
      });
    } catch (caught) {
      const code = (caught as { code?: unknown })?.code;
      if (code === "P2025") {
        throw new NotFoundException("令牌不存在");
      }
      throw caught;
    }
  }

  /**
   * PAT 验证。任何失败（不存在/已撤销/已过期/用户禁用）统一返回 null，
   * 由调用方给出统一 401 措辞，不区分具体原因。
   */
  async authenticate(rawToken: string): Promise<ApiTokenIdentity | null> {
    const record = await this.prisma.apiToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      select: {
        id: true,
        userId: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    if (!record) return null;
    if (record.revokedAt !== null) return null;
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== "active") return null;

    const lastUsed = record.lastUsedAt?.getTime() ?? 0;
    if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
      void this.prisma.apiToken
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }
    return { userId: record.userId, tokenId: record.id };
  }
}
