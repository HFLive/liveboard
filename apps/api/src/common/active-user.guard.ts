import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { PrismaService } from "../modules/prisma/prisma.service";
import { MaintenanceService } from "../modules/maintenance/maintenance.service";
import { IS_PUBLIC_KEY } from "./public.decorator";
import {
  getSessionCookieName,
  HTTP_SESSION_COOKIE_NAME,
  HTTPS_SESSION_COOKIE_NAME,
  shouldUseSecureSessionCookie,
  verifySessionCookies,
} from "./session-cookie";

export interface AuthenticatedRequest extends Request {
  currentUserId?: string;
  /** 导入腾空窗口（DB 不可用）期间降级放行的标记：会话 cookie 已验证，但未做 DB 用户状态检查。 */
  degradedSession?: boolean;
}

function hasAnySessionCookie(cookies: Record<string, string | undefined>) {
  return Boolean(
    cookies[HTTPS_SESSION_COOKIE_NAME] || cookies[HTTP_SESSION_COOKIE_NAME],
  );
}

/**
 * 清除两个会话 cookie（与登出控制器一致）。配合中间件对 /login 的
 * 「已登录跳转」，必须把「存在但已失效」的会话 cookie 清掉，否则用户会
 * 在 /login 与 /app 之间无限跳转。
 */
function clearSessionCookies(response: Response) {
  const secure = shouldUseSecureSessionCookie();
  response.clearCookie(getSessionCookieName(secure), {
    path: "/",
    sameSite: "lax",
    secure,
  });
  response.clearCookie(
    secure ? HTTP_SESSION_COOKIE_NAME : HTTPS_SESSION_COOKIE_NAME,
    { path: "/", sameSite: "lax", secure: false },
  );
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
    const response = context.switchToHttp().getResponse<Response>();
    const cookies = request.cookies as
      Record<string, string | undefined> | undefined;
    const session = verifySessionCookies(cookies);
    if (!session) {
      // 存在但已失效（过期/签名不符/配置分裂）的 cookie 需要清掉，
      // 否则死 cookie 会一直保留并让中间件反复把用户弹去登录页。
      if (cookies && hasAnySessionCookie(cookies)) {
        clearSessionCookies(response);
      }
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
      if (method === "GET" && (await this.maintenance.isEnabled())) {
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
      clearSessionCookies(response);
      throw new UnauthorizedException("Session is no longer valid");
    }

    request.currentUserId = user.id;
    return true;
  }
}
