import {
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
import { RedisService } from "../redis/redis.service";

export type { MaintenanceState };

/**
 * "维护/只读模式"开关。状态不能存数据库，因为导入/Neon 回滚会整体替换
 * 数据库：self_hosted 存迁移目录的 `maintenance.json`；Vercel 存 Redis。
 *
 * - 开启后由 `MaintenanceModeGuard` 拒绝普通用户的写操作；super_admin 与
 *   维护/迁移相关端点放行。
 * - Vercel 回滚期间由 BackupVercelExecutor 自动开关；Redis 不可读时
 *   `isEnabled` fail closed，按维护已开启阻断普通写操作。
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
    private readonly redis: RedisService,
  ) {
    this.deploymentTarget = getDeploymentTarget(config);
    this.paths = migrationDataPaths(config);
  }

  /** 缺失视为关闭；读错误由 isEnabled fail closed（按开启处理）。 */
  async isEnabled(): Promise<boolean> {
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
    if (this.deploymentTarget === "vercel") {
      const client = await this.redis.getClient();
      if (!client) {
        throw new ServiceUnavailableException("Redis 服务暂不可用");
      }
      const raw = await client.get(VERCEL_MAINTENANCE_KEY);
      if (!raw) return MAINTENANCE_OFF;
      return parseMaintenanceState(raw);
    }
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
    if (
      this.deploymentTarget !== "vercel" &&
      !ensureMigrationDirs(this.paths)
    ) {
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
      await this.writeState(next);
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

  /**
   * 供备份/迁移状态机调用的系统开关，不依赖会在换库期间消失的用户行。
   * 仅通过 Nest 依赖注入在服务端内部使用，不暴露为未鉴权端点。
   */
  async setSystemEnabled(
    enabled: boolean,
    reason?: string,
  ): Promise<MaintenanceState> {
    const run = async (): Promise<MaintenanceState> => {
      const next: MaintenanceState = {
        enabled,
        reason: enabled ? reason?.trim() || null : null,
        updatedAt: new Date().toISOString(),
        updatedBy: null,
      };
      await this.writeState(next);
      this.logger.log(
        `系统自动将维护模式${enabled ? "开启" : "关闭"}${reason ? `（${reason}）` : ""}`,
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

  private async writeState(state: MaintenanceState): Promise<void> {
    if (this.deploymentTarget === "vercel") {
      const client = await this.redis.getClient();
      if (!client) {
        throw new ServiceUnavailableException("Redis 服务暂不可用");
      }
      await client.set(VERCEL_MAINTENANCE_KEY, JSON.stringify(state));
      return;
    }
    await writeMaintenanceStateFile(this.paths.maintenanceFile, state);
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

const VERCEL_MAINTENANCE_KEY = "liveboard:maintenance:state";

function parseMaintenanceState(raw: string): MaintenanceState {
  const parsed = JSON.parse(raw) as Partial<MaintenanceState>;
  return {
    enabled: parsed.enabled === true,
    reason: typeof parsed.reason === "string" ? parsed.reason : null,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : null,
  };
}
