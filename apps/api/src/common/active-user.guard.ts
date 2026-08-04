import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PrismaService } from "../modules/prisma/prisma.service";
import { MaintenanceService } from "../modules/maintenance/maintenance.service";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { verifySessionCookies } from "./session-cookie";

export interface AuthenticatedRequest extends Request {
  currentUserId?: string;
  /** 导入腾空窗口（DB 不可用）期间降级放行的标记：会话 cookie 已验证，但未做 DB 用户状态检查。 */
  degradedSession?: boolean;
}

@Injectable()
export class ActiveUserGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly maintenance: MaintenanceService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = request.cookies as
      Record<string, string | undefined> | undefined;
    const session = verifySessionCookies(cookies);
    if (!session) {
      throw new UnauthorizedException("Missing or invalid session");
    }

    let user: {
      id: string;
      status: string;
      sessionVersion: number;
    } | null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, status: true, sessionVersion: true },
      });
    } catch (caught) {
      // 导入腾空窗口（DROP SCHEMA 重建库）期间 User 表缺失，DB 查询抛
      // P2021 等 Prisma 错误。此时维护模式开启：GET 请求降级为"仅校验会话
      // cookie 签名"，让任务进度轮询可用；写请求与非维护窗口保持 fail-closed。
      const prismaCode = (caught as { code?: unknown })?.code;
      const dbUnavailable =
        typeof prismaCode === "string" && prismaCode.startsWith("P");
      if (!dbUnavailable) throw caught;
      const method = (request.method ?? "GET").toUpperCase();
      if (
        method === "GET" &&
        (await this.maintenance.isEnabled())
      ) {
        request.currentUserId = session.userId;
        request.degradedSession = true;
        return true;
      }
      throw caught;
    }
    if (
      !user ||
      user.status !== "active" ||
      user.sessionVersion !== session.sessionVersion
    ) {
      throw new UnauthorizedException("Session is no longer valid");
    }

    request.currentUserId = user.id;
    return true;
  }
}
