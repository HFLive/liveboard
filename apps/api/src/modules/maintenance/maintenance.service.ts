import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isSuperAdmin } from "@liveboard/shared";
import {
  getDeploymentTarget,
  type DeploymentTarget,
} from "../../common/deployment-target";
import {
  ensureMigrationDirs,
  migrationDataPaths,
  type MigrationDataPaths,
} from "../migration/migration-dirs";
import {
  MAINTENANCE_OFF,
  readMaintenanceStateFile,
  writeMaintenanceStateFile,
  type MaintenanceState,
} from "../migration/maintenance-file";
import { PrismaService } from "../prisma/prisma.service";

export type { MaintenanceState };

/**
 * "维护/只读模式"开关。状态存于迁移数据目录的 `maintenance.json`（而非数据库），
 * 因为导入期间目标库会被整体重建，开关必须在不依赖数据库的情况下仍可读取。
 *
 * - 开启后由 `MaintenanceModeGuard` 拒绝普通用户的写操作；super_admin 与
 *   维护/迁移相关端点放行。
 * - Vercel 无持久化磁盘，该开关恒为关闭，相关端点返回明确错误。
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly deploymentTarget: DeploymentTarget;
  private readonly paths: MigrationDataPaths;
  /** 串行化连续 setEnabled，避免并发写坏状态文件。 */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.deploymentTarget = getDeploymentTarget(config);
    this.paths = migrationDataPaths(config);
  }

  /** Vercel 恒为关闭；自托管读取状态文件，缺失视为关闭、读错误 fail-closed（按开启处理）。 */
  async isEnabled(): Promise<boolean> {
    if (this.deploymentTarget === "vercel") return false;
    try {
      return (await this.getState()).enabled;
    } catch (caught) {
      // 状态文件不可读（损坏/权限）：按"维护开启"处理，阻断普通用户写请求，
      // 绝不静默放行（fail-closed）。
      this.logger.error(
        `读取维护状态失败，按开启处理：${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
      return true;
    }
  }

  async getState(): Promise<MaintenanceState> {
    if (this.deploymentTarget === "vercel") return MAINTENANCE_OFF;
    return readMaintenanceStateFile(this.paths.maintenanceFile);
  }

  /** 管理员视角读取状态；非 super_admin 抛 403。 */
  async getStateForAdmin(userId: string | null): Promise<MaintenanceState> {
    await this.requireSuperAdmin(userId);
    return this.getState();
  }

  /** 切换维护模式。仅 super_admin 可调用；写操作失败会抛异常。 */
  async setEnabled(
    userId: string | null,
    enabled: boolean,
    reason?: string,
  ): Promise<MaintenanceState> {
    if (this.deploymentTarget === "vercel") {
      throw new ConflictException(
        "Vercel 环境没有持久化磁盘，不支持维护模式开关",
      );
    }
    if (!ensureMigrationDirs(this.paths)) {
      throw new ServiceUnavailableException(
        "无法访问迁移数据目录，请检查 MIGRATION_DATA_DIR 是否已正确挂载",
      );
    }
    // 串行化连续开关（进程内 promise 链锁），避免并发切换写坏状态文件。
    const run = async (): Promise<MaintenanceState> => {
      await this.requireSuperAdmin(userId);
      const next: MaintenanceState = {
        enabled,
        reason: enabled ? reason?.trim() || null : null,
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      };
      await writeMaintenanceStateFile(this.paths.maintenanceFile, next);
      this.logger.log(
        `维护模式已${enabled ? "开启" : "关闭"}${reason ? `（${reason}）` : ""}`,
      );
      return next;
    };
    const scheduled = this.writeChain.then(run, run);
    this.writeChain = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  private async requireSuperAdmin(userId: string | null) {
    if (!userId) throw new ForbiddenException("缺少登录会话");
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { systemRole: true, status: true },
    });
    if (!user || !isSuperAdmin(user.systemRole) || user.status !== "active") {
      throw new ForbiddenException("只有最高管理员可以管理维护模式");
    }
    return user;
  }
}
