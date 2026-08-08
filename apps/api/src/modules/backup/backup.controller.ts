import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { Public } from "../../common/public.decorator";
import { RedisService } from "../redis/redis.service";
import {
  RETENTION_MAX,
  RETENTION_MIN,
  SCHEDULE_HOUR_MAX,
  SCHEDULE_HOUR_MIN,
  SCHEDULE_MINUTE_MAX,
  SCHEDULE_MINUTE_MIN,
  SCHEDULE_WEEKDAY_MAX,
  SCHEDULE_WEEKDAY_MIN,
} from "./backup-schedule";
import { BackupService } from "./backup.service";

class UpdateBackupSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(SCHEDULE_HOUR_MIN)
  @Max(SCHEDULE_HOUR_MAX)
  scheduleHour?: number;

  @IsOptional()
  @IsInt()
  @Min(SCHEDULE_MINUTE_MIN)
  @Max(SCHEDULE_MINUTE_MAX)
  scheduleMinute?: number;

  /** null = 每天；0-6 = 周日..周六。 */
  @IsOptional()
  @IsInt()
  @Min(SCHEDULE_WEEKDAY_MIN)
  @Max(SCHEDULE_WEEKDAY_MAX)
  scheduleWeekday?: number | null;

  @IsOptional()
  @IsInt()
  @Min(RETENTION_MIN)
  @Max(RETENTION_MAX)
  autoRetention?: number;

  @IsOptional()
  @IsBoolean()
  includeObjects?: boolean;
}

class StartBackupDto {
  /** 可选覆盖设置的备份范围；缺省用 BackupSettings.includeObjects。 */
  @IsOptional()
  @IsBoolean()
  includeObjects?: boolean;
}

class StartRestoreDto {
  /** 回滚确认语（getInfo 返回），不匹配直接拒绝。 */
  @IsString()
  confirm!: string;

  /** 可选覆盖：是否连同文件对象一起回拷；缺省用目标备份的 includeObjects。 */
  @IsOptional()
  @IsBoolean()
  includeObjects?: boolean;
}

const TICK_LOCK_KEY = "liveboard:cron:backup-tick";
const TICK_LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * 备份与回滚的 admin 端点（全部 super_admin）+ Vercel 调度入口。
 * Vercel 是 Serverless，禁用常驻定时器，由 vercel.json crons 打
 * internal/cron/backup 端点触发同一 tick()（应用层按 lastAutoBackupAt 判定
 * 是否该跑）；self_hosted 的 tick 由 BackupService 进程内 setInterval 驱动。
 * 带 ?jobId=<id> 的请求是任务的接力续跑（self-invocation），只推进该任务，
 * 不走 tick 锁；认证同为 CRON_SECRET。
 * - 认证：`Authorization: Bearer ${CRON_SECRET}`，恒定时间比较。
 * - Redis 分布式锁防止重复执行；调度判定幂等。
 * - 未授权一律 401，不返回任何业务信息。
 */
@Controller()
export class BackupController {
  private readonly logger = new Logger(BackupController.name);
  private readonly expectedSecret: string;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
    private readonly backup: BackupService,
  ) {
    this.expectedSecret = config.get<string>("CRON_SECRET", "") ?? "";
  }

  @Get("admin/backup/info")
  async info(@CurrentUserId() userId: string | null) {
    return { info: await this.backup.getInfo(userId) };
  }

  @Patch("admin/backup/settings")
  async updateSettings(
    @CurrentUserId() userId: string | null,
    @Body() body: UpdateBackupSettingsDto,
  ) {
    return { settings: await this.backup.updateSettings(userId, body) };
  }

  @Get("admin/backup/jobs")
  async listJobs(@CurrentUserId() userId: string | null) {
    return { jobs: await this.backup.listJobs(userId) };
  }

  @Get("admin/backup/jobs/:id")
  async getJob(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return { job: await this.backup.getJob(userId, id) };
  }

  /** 硬删除单个备份：数据库与文件一并删除，不可恢复。 */
  @Delete("admin/backup/jobs/:id")
  async deleteJob(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return await this.backup.deleteBackup(id);
  }

  /** 清除失败任务的报错信息（已读），不再每次进入备份页重复弹出。 */
  @Post("admin/backup/jobs/:id/dismiss")
  async dismissJobError(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return { job: await this.backup.dismissJobError(userId, id) };
  }

  @Post("admin/backup/run")
  async startManualBackup(
    @CurrentUserId() userId: string | null,
    @Body() body: StartBackupDto,
  ) {
    return {
      job: await this.backup.startManualBackup(userId, {
        includeObjects: body.includeObjects,
      }),
    };
  }

  /**
   * 从备份回滚：先自动创建一次保护备份，成功后链式启动恢复。
   * 返回两条任务（保护备份 + 回滚），互斥锁覆盖整条链。
   */
  @Post("admin/backup/:id/restore")
  async startRestore(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
    @Body() body: StartRestoreDto,
  ) {
    return await this.backup.startRestore(userId, id, {
      confirm: body.confirm,
      includeObjects: body.includeObjects,
    });
  }

  /**
   * @Public：ActiveUserGuard 是全局守卫，不带 @Public() 的端点必须先有会话
   * cookie 才放行——cron/self-invocation 请求只有 Bearer CRON_SECRET，会被
   * 守卫在 isAuthorized 之前以 401「Missing or invalid session」拦掉，导致
   * Vercel 闹钟与接力续跑全部失效（曾线上排查数日）。真实认证在下方
   * isAuthorized（恒定时间比较），放行后仍需密钥。
   */
  @Public()
  @Get("internal/cron/backup")
  async cronTick(
    @Headers("authorization") authorization?: string,
    @Query("jobId") jobId?: string,
  ) {
    if (!this.isAuthorized(authorization)) {
      throw new UnauthorizedException();
    }
    // 接力续跑（self-invocation）：只推进指定任务，不走 tick 锁——
    // 同一任务的并发由 per-job Redis 锁串行化，无进展的棒不会自续。
    if (jobId) {
      return { ok: true, ...(await this.backup.continueVercelJob(jobId)) };
    }
    const client = await this.redis.getClient().catch(() => null);
    let releaseLock: (() => Promise<void>) | null = null;
    if (client) {
      const acquired = await client.set(TICK_LOCK_KEY, "1", {
        NX: true,
        PX: TICK_LOCK_TTL_MS,
      });
      if (acquired !== "OK") {
        // 另一个实例正在 tick，跳过本次。
        return { ok: true, ran: false, skipped: true };
      }
      releaseLock = () =>
        client
          .del(TICK_LOCK_KEY)
          .then(() => undefined)
          .catch(() => undefined);
    } else {
      this.logger.warn("Redis 不可用，跳过分布式锁直接执行 tick（幂等）");
    }
    try {
      const result = await this.backup.tick();
      return { ok: true, ...result };
    } finally {
      await releaseLock?.();
    }
  }

  private isAuthorized(authorization: string | undefined) {
    if (!this.expectedSecret) return false;
    const expected = `Bearer ${this.expectedSecret}`;
    const actual = authorization ?? "";
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
