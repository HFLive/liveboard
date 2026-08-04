import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isSuperAdmin } from "@liveboard/shared";
import { IS_PUBLIC_KEY } from "../../common/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { MaintenanceService } from "./maintenance.service";

/**
 * 维护/只读模式守卫（全局，注册在 ActiveUserGuard 之后）。
 *
 * - 读方法（GET/HEAD/OPTIONS）恒放行，避免每次请求读状态文件。
 * - 维护模式关闭时直接放行。
 * - 开启时：公开路由（登录、健康检查）、维护/迁移自服务端点、登出放行；
 *   super_admin 保留全部写操作；其余写请求返回 503。
 * - 开启期间数据库不可用（例如导入腾空重建）时，写操作保守阻断（fail-closed）。
 */
@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly maintenance: MaintenanceService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const method = (request.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return true;
    }

    if (!(await this.maintenance.isEnabled())) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const path: string = request.path ?? request.originalUrl ?? "/";
    // 维护模式开关、数据迁移端点：具体鉴权由对应 controller/service 执行。
    if (path.startsWith("/admin/maintenance")) return true;
    if (path.startsWith("/admin/migration")) return true;
    // 登出必须始终可用，避免普通用户被维护模式"卡"在会话里。
    if (path === "/auth/logout") return true;

    const userId: string | undefined = request.currentUserId;
    if (userId) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { systemRole: true, status: true },
        });
        if (user && user.status === "active" && isSuperAdmin(user.systemRole)) {
          return true;
        }
      } catch {
        throw new ServiceUnavailableException(
          "系统维护中，暂时无法写入，请稍后再试",
        );
      }
    }

    throw new ServiceUnavailableException(
      "系统维护中，站点暂时只读，请稍后再试",
    );
  }
}
