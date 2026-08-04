import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn, type ChildProcess } from "node:child_process";
import { readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { requireSuperAdmin } from "../../common/require-super-admin";
import {
  ensureMigrationDirs,
  migrationDataPaths,
  type MigrationDataPaths,
} from "./migration-dirs";
import {
  readJobState,
  writeJobState,
  type MigrationJobFileState,
} from "./migration-job-file";
import { messageOf } from "./migration-engine";
import { DEFAULT_IMPORT_CONFIRM_PHRASE } from "./migration-manifest";
import { PrismaService } from "../prisma/prisma.service";

export interface JobSummary {
  id: string;
  kind: "export" | "import";
  status: MigrationJobFileState["status"];
  phase: string;
  progress: MigrationJobFileState["progress"];
  packageName: string | null;
  appVersion: string | null;
  manifest: unknown;
  error: string | null;
  createdBy: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
}

export interface IncomingPackage {
  name: string;
  type: "tar" | "dir";
  sizeBytes: number;
  hasManifest: boolean;
}

const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * stale 状态文件 TTL 兜底：spawn 失败或进程重启可能遗留 pending/running 状态文件，
 * 若不清理会永久锁死后续所有迁移任务。
 * - pending：从 createJobRow 到子进程写 running 仅毫秒级，2 分钟无假阳性；
 * - running：对象导入每 10 个/每阶段都写状态文件，6 小时不会误杀正常任务。
 */
const STALE_PENDING_MS = 2 * 60 * 1000;
const STALE_RUNNING_MS = 6 * 60 * 60 * 1000;

/** Prisma P2021（表不存在）：导入腾空窗口（DROP SCHEMA）期间 User/MigrationJob 表被删。 */
function isTableMissingError(caught: unknown): boolean {
  const error = caught as { code?: unknown; message?: unknown };
  return (
    error?.code === "P2021" ||
    (typeof error?.message === "string" &&
      error.message.includes("does not exist"))
  );
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);
  private readonly paths: MigrationDataPaths;
  /**
   * 本进程正在运行的迁移任务（互斥锁）。启动任务前同步置位以关闭并发竞态，
   * spawnScript 成功后替换为真实 jobId，子进程 exit 时清空；"starting" 是
   * 异步校验期间占位的哨兵值。
   */
  private runningJobId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.paths = migrationDataPaths(config);
  }

  // ---- 互斥锁 --------------------------------------------------------------

  /** 同步抢占互斥锁：已有任务（含正在启动的）则拒绝，无任务则置哨兵占位。 */
  private reserveJobLock(): void {
    if (this.runningJobId) {
      throw new ConflictException(
        "已有迁移任务正在执行，请等待其完成后再启动新任务",
      );
    }
    this.runningJobId = "starting";
  }

  private releaseJobLock(): void {
    this.runningJobId = null;
  }

  /**
   * 文件级互斥检查：任务真实进度以状态文件为准（导入会重建 MigrationJob 表，
   * 不能依赖 DB），因此同时扫描 jobs/ 下所有状态文件，发现 pending/running
   * 即拒绝。覆盖本进程之外（进程重启/其他实例）遗留的运行中任务。
   * 检查前先对超时未更新的 stale 状态做兜底清理，避免 spawn 失败/进程重启
   * 留下的僵尸状态把任务系统永久锁死。
   */
  private async assertNoRunningJobInFiles(): Promise<void> {
    await this.reconcileStaleJobStates();
    const states = await this.readStateFiles();
    for (const [jobId, state] of states) {
      if (state.status === "running" || state.status === "pending") {
        throw new ConflictException(
          `已有迁移任务 #${jobId}（${state.kind}）正在执行或等待启动，请等待其完成后再启动新任务`,
        );
      }
    }
  }

  /**
   * TTL 兜底：把超过阈值仍未更新的 pending/running 状态文件落为 failed，
   * 解锁后续任务。阈值保守（见 STALE_PENDING_MS / STALE_RUNNING_MS 注释），
   * 正常情况下不会误伤仍在进行的任务。
   */
  private async reconcileStaleJobStates(): Promise<void> {
    const now = Date.now();
    const states = await this.readStateFiles();
    for (const [jobId, state] of states) {
      if (state.status !== "pending" && state.status !== "running") continue;
      const maxAge =
        state.status === "pending" ? STALE_PENDING_MS : STALE_RUNNING_MS;
      const updatedAt = state.updatedAt
        ? new Date(state.updatedAt).getTime()
        : NaN;
      const age = Number.isFinite(updatedAt) ? now - updatedAt : Infinity;
      if (age < maxAge) continue;
      this.logger.warn(
        `迁移任务 ${jobId} 状态文件失联（${state.status}，updatedAt=${state.updatedAt}），已自动解锁落为 failed`,
      );
      await writeJobState(this.paths.jobsDir, jobId, {
        status: "failed",
        error:
          state.status === "pending"
            ? "迁移进程未能启动，已自动解锁"
            : "迁移进程失联，已自动解锁",
        finishedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
  }

  /**
   * 子进程退出后，若状态文件仍停留在 pending/running（进程异常退出、从未写入
   * 终态），落为 failed，避免 stale 状态把后续任务永久锁死。
   */
  private async failStuckJobState(
    jobId: string,
    exitCode: number | null,
  ): Promise<void> {
    const state = await readJobState(this.paths.jobsDir, jobId);
    if (!state) return;
    if (state.status === "pending" || state.status === "running") {
      await writeJobState(this.paths.jobsDir, jobId, {
        status: "failed",
        error: `迁移进程异常退出（exit=${exitCode ?? "null"}）`,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  // ---- 部署形态与降级 ---------------------------------------------------------

  private isVercelDeployment(): boolean {
    return this.config.get<string>("DEPLOYMENT_TARGET") === "vercel";
  }

  /**
   * Vercel 无持久磁盘，后台迁移（上传/导出/导入/下载）直接拒绝，给出明确提示；
   * 不让接口落到"目录不可用"的模糊报错。
   */
  private assertMigrationSupported(): void {
    if (this.isVercelDeployment()) {
      throw new ServiceUnavailableException(
        "Vercel 无持久磁盘，不支持后台数据迁移（请在自托管服务器上执行 CLI 脚本）",
      );
    }
  }

  /**
   * 状态类接口的鉴权：正常返回 "admin"。导入腾空窗口（DROP SCHEMA → pg_restore）
   * 期间 User 表不存在，任何 DB 查询都报 P2021；此时若确有导入任务在运行，返回
   * "degraded"，由调用方降级为纯状态文件读取，避免前端轮询整条链路 500。
   */
  private async authorizeForStateRead(
    userId: string | null,
  ): Promise<"admin" | "degraded"> {
    try {
      await requireSuperAdmin(this.prisma, userId);
      return "admin";
    } catch (caught) {
      if (isTableMissingError(caught) && (await this.hasRunningImportJob())) {
        return "degraded";
      }
      throw caught;
    }
  }

  /** 状态文件里是否存在运行中的导入任务（导入窗口的唯一可信信号）。 */
  private async hasRunningImportJob(): Promise<boolean> {
    const states = await this.readStateFiles();
    for (const state of states.values()) {
      if (
        state.kind === "import" &&
        (state.status === "running" || state.status === "pending")
      ) {
        return true;
      }
    }
    return false;
  }

  // ---- 状态查询 -------------------------------------------------------------

  private confirmPhrase(): string {
    return (
      process.env.MIGRATION_IMPORT_CONFIRM_PHRASE?.trim() ||
      DEFAULT_IMPORT_CONFIRM_PHRASE
    );
  }

  async listJobs(userId: string | null): Promise<JobSummary[]> {
    const mode = await this.authorizeForStateRead(userId);
    const stateFiles = await this.readStateFiles();
    // 导入腾空窗口期间 DB 不可用：仅返回状态文件里的任务（进度仍在更新）。
    if (mode === "degraded") {
      const summaries: JobSummary[] = [];
      for (const [id, state] of stateFiles) {
        summaries.push(await this.mergeJob(id, state, null));
      }
      return summaries.sort((a, b) =>
        (b.createdAt ?? b.updatedAt ?? "").localeCompare(
          a.createdAt ?? a.updatedAt ?? "",
        ),
      );
    }
    const rows = await this.prisma.migrationJob
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      })
      .catch(() => null);

    const byId = new Map(rows?.map((row) => [row.id, row]) ?? []);
    const ids = new Set<string>();
    for (const row of rows ?? []) ids.add(row.id);
    for (const file of stateFiles.values()) ids.add(file.jobId);

    const summaries: JobSummary[] = [];
    for (const id of ids) {
      summaries.push(
        await this.mergeJob(
          id,
          stateFiles.get(id) ?? null,
          byId.get(id) ?? null,
        ),
      );
    }
    return summaries.sort((a, b) =>
      (b.createdAt ?? b.updatedAt ?? "").localeCompare(
        a.createdAt ?? a.updatedAt ?? "",
      ),
    );
  }

  async getJob(userId: string | null, jobId: string): Promise<JobSummary> {
    const mode = await this.authorizeForStateRead(userId);
    if (mode === "degraded") {
      const summary = await this.getJobFromStateOnly(jobId);
      if (!summary) throw new NotFoundException("迁移任务不存在");
      return summary;
    }
    return this.loadJob(jobId);
  }

  /** 只读取状态文件，供不依赖数据库的降级路径（导入期间 DB 不可用）。 */
  async getJobFromStateOnly(jobId: string): Promise<JobSummary | null> {
    const state = await readJobState(this.paths.jobsDir, jobId);
    if (!state) return null;
    return this.mergeJob(jobId, state, null);
  }

  private async loadJob(jobId: string): Promise<JobSummary> {
    const [state, row] = await Promise.all([
      readJobState(this.paths.jobsDir, jobId),
      this.prisma.migrationJob
        .findUnique({ where: { id: jobId } })
        .catch(() => null),
    ]);
    if (!state && !row) {
      throw new NotFoundException("迁移任务不存在");
    }
    return this.mergeJob(jobId, state, row);
  }

  async listIncoming(userId: string | null): Promise<IncomingPackage[]> {
    // 导入窗口期间 DB 不可用：降级为仅读文件系统（incoming 列表为低敏感数据）。
    await this.authorizeForStateRead(userId);
    if (!ensureMigrationDirs(this.paths)) {
      throw new ServiceUnavailableException(
        "无法访问迁移数据目录，请检查 MIGRATION_DATA_DIR 挂载",
      );
    }
    const entries = await readdir(this.paths.incomingDir, {
      withFileTypes: true,
    });
    const packages: IncomingPackage[] = [];
    for (const entry of entries) {
      const full = path.join(this.paths.incomingDir, entry.name);
      if (entry.isDirectory()) {
        const hasManifest = await stat(path.join(full, "manifest.json"))
          .then(() => true)
          .catch(() => false);
        const size = await dirSize(full);
        packages.push({
          name: entry.name,
          type: "dir",
          sizeBytes: size,
          hasManifest,
        });
      } else if (entry.isFile() && entry.name.endsWith(".tar")) {
        const size = await stat(full)
          .then((s) => s.size)
          .catch(() => 0);
        packages.push({
          name: entry.name,
          type: "tar",
          sizeBytes: size,
          hasManifest: true,
        });
      }
    }
    return packages.sort((a, b) => a.name.localeCompare(b.name));
  }

  async uploadPackage(
    userId: string | null,
    file?: { originalname?: string; size?: number; path?: string },
  ) {
    this.assertMigrationSupported();
    try {
      await requireSuperAdmin(this.prisma, userId);
      if (!ensureMigrationDirs(this.paths)) {
        throw new ServiceUnavailableException("无法访问迁移数据目录，请检查挂载");
      }
      if (!file) throw new BadRequestException("未收到文件");
      if (!file.path) throw new BadRequestException("上传文件未落盘");
      if ((file.size ?? 0) > MAX_UPLOAD_SIZE_BYTES) {
        throw new BadRequestException("迁移包超过 100MB，请改用服务器目录导入");
      }
      const original = file.originalname ?? "migration.tar";
      if (!original.endsWith(".tar")) {
        throw new BadRequestException("只支持 .tar 迁移包");
      }
      const safeName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${original
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .slice(0, 120)}`;
      const target = path.join(this.paths.incomingDir, safeName);
      await rename(file.path, target);
      return { name: safeName, sizeBytes: file.size };
    } catch (caught) {
      // 清理 multer 已落盘的文件：鉴权/校验失败时文件留在 incoming 临时区，
      // 任意登录用户可反复上传占满磁盘（multer 只清理自身处理阶段的错误）。
      if (file?.path) {
        await rm(file.path, { force: true }).catch(() => undefined);
      }
      throw caught;
    }
  }

  /** 解析导入包路径：允许绝对路径（必须位于数据目录内）或 incoming 下的名称。 */
  private resolvePackageSource(source: string): string {
    if (!ensureMigrationDirs(this.paths)) {
      throw new ServiceUnavailableException("无法访问迁移数据目录，请检查挂载");
    }
    const normalized = path.isAbsolute(source)
      ? path.normalize(source)
      : path.normalize(path.join(this.paths.incomingDir, source));
    if (!normalized.startsWith(this.paths.dataDir + path.sep)) {
      throw new BadRequestException("迁移包必须在迁移数据目录内");
    }
    return normalized;
  }

  // ---- 任务启动 -------------------------------------------------------------

  async startExport(
    userId: string | null,
    options: { includeObjects?: boolean; pushToR2?: boolean },
  ): Promise<JobSummary> {
    this.reserveJobLock();
    let spawned = false;
    try {
      this.assertMigrationSupported();
      await requireSuperAdmin(this.prisma, userId);
      if (!ensureMigrationDirs(this.paths)) {
        throw new ServiceUnavailableException("无法访问迁移数据目录，请检查挂载");
      }
      await this.assertNoRunningJobInFiles();
      const job = await this.createJobRow(userId, "export");
      const args = [
        "--job-id",
        job.id,
        "--concurrency",
        "4",
        "--ensure-maintenance",
      ];
      if (options.pushToR2) {
        args.push("--push-r2");
      } else if (options.includeObjects === false) {
        args.push("--no-objects");
      }
      this.spawnScript("migrate-export", args, job.id);
      spawned = true;
      return await this.loadJob(job.id);
    } catch (caught) {
      // 仅当任务尚未成功 spawn（比如权限或目录检查失败）时释放锁；
      // 已 spawn 的任务由子进程 exit 处理器负责清锁。
      if (!spawned) this.releaseJobLock();
      throw caught;
    }
  }

  async startImport(
    userId: string | null,
    options: { source: string; confirm: string },
  ): Promise<JobSummary> {
    this.reserveJobLock();
    let spawned = false;
    try {
      this.assertMigrationSupported();
      await requireSuperAdmin(this.prisma, userId);
      const expectedConfirm = this.confirmPhrase();
      if (!options.confirm || options.confirm.trim() !== expectedConfirm) {
        throw new BadRequestException(
          `请输入确认语 ${expectedConfirm} 以确认清空目标并导入`,
        );
      }
      const sourcePath = this.resolvePackageSource(options.source);
      await this.assertNoRunningJobInFiles();
      // 目标后端在腾空前的目标库中读取（还原后会被源数据覆盖，不能再作为依据）。
      const storage = await this.prisma.storageSettings
        .findFirst()
        .catch(() => null);
      const targetBackend = storage?.backend ?? "minio";
      const job = await this.createJobRow(userId, "import");
      this.spawnScript(
        "migrate-import",
        [
          "--job-id",
          job.id,
          "--source",
          sourcePath,
          "--confirm",
          options.confirm,
          "--target-backend",
          targetBackend,
          "--concurrency",
          "4",
          "--ensure-maintenance",
        ],
        job.id,
      );
      spawned = true;
      return await this.loadJob(job.id);
    } catch (caught) {
      if (!spawned) this.releaseJobLock();
      throw caught;
    }
  }

  /** 导出包下载（.tar 文件路径与大小，供 Range/Content-Length 使用）。 */
  async exportPackagePath(
    userId: string | null,
    name: string,
  ): Promise<{ path: string; size: number }> {
    this.assertMigrationSupported();
    await requireSuperAdmin(this.prisma, userId);
    if (!/^[A-Za-z0-9._-]+\.tar$/.test(name)) {
      throw new BadRequestException("无效的导出包名称");
    }
    const full = path.join(this.paths.exportsDir, name);
    const info = await stat(full).catch(() => null);
    if (!info || !info.isFile()) throw new NotFoundException("导出包不存在");
    return { path: full, size: info.size };
  }

  /** 迁移功能信息：是否可用、确认语、部署形态、当前目标存储后端。 */
  async getInfo(userId: string | null) {
    // 导入腾空窗口期间 DB 不可用，storage 后端读不到，按默认 minio 展示（仅展示用）。
    const mode = await this.authorizeForStateRead(userId);
    const storage =
      mode === "degraded"
        ? null
        : await this.prisma.storageSettings.findFirst().catch(() => null);
    const base = {
      available: ensureMigrationDirs(this.paths),
      maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
      deploymentTarget:
        this.config.get<string>("DEPLOYMENT_TARGET") === "vercel"
          ? "vercel"
          : "server",
      targetBackend: storage?.backend ?? "minio",
    };
    // 降级模式（导入窗口期间 DB 不可用）：仅返回低敏感展示信息，不含
    // confirmPhrase/dataDir/R2 可用性，避免向无法核验身份的访问者泄露。
    if (mode === "degraded") return base;
    return {
      ...base,
      dataDir: this.paths.dataDir,
      confirmPhrase: this.confirmPhrase(),
      // 直推目标 R2 是否可用：源服务器是否已配置 TARGET_R2_*（或应用自身 R2_*）。
      pushToR2Available:
        ["ACCOUNT_ID", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"].every(
          (suffix) => process.env[`TARGET_R2_${suffix}`]?.trim(),
        ) ||
        ["ACCOUNT_ID", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"].every(
          (suffix) => process.env[`R2_${suffix}`]?.trim(),
        ),
    };
  }

  // ---- 内部实现 -------------------------------------------------------------

  private async createJobRow(
    userId: string | null,
    kind: "export" | "import",
  ): Promise<{ id: string }> {
    // 导出/导入按钮都先落一行 DB 记录（导入的该行会被腾空重建，但给了 UI
    // 一个可读的初始状态）；任务真实进度以本地状态文件为准。
    const user = await requireSuperAdmin(this.prisma, userId);
    const row = await this.prisma.migrationJob.create({
      data: { kind, status: "pending", createdById: user.id },
      select: { id: true },
    });
    await writeJobState(this.paths.jobsDir, row.id, {
      kind,
      status: "pending",
      phase: "prepare",
      startedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return row;
  }

  private spawnScript(
    script: "migrate-export" | "migrate-import",
    args: string[],
    jobId: string,
  ) {
    const apiRoot = path.resolve(__dirname, "..", "..", "..");
    const scriptPath = path.join(apiRoot, "scripts", `${script}.ts`);
    const tsx = path.join(apiRoot, "node_modules", ".bin", "tsx");
    // 锁替换为真实 jobId；子进程 exit/error 时清锁。
    this.runningJobId = jobId;
    let child: ChildProcess;
    try {
      child = spawn(tsx, [scriptPath, ...args], {
        env: process.env,
        stdio: "inherit",
        detached: true,
      });
    } catch (caught) {
      this.logger.error(`无法启动迁移脚本 ${script}: ${messageOf(caught)}`);
      throw new ServiceUnavailableException(
        "无法启动迁移脚本，请检查 API 镜像内是否包含 tsx 与 scripts 目录",
      );
    }
    const releaseLock = () => {
      if (this.runningJobId === jobId) this.runningJobId = null;
    };
    child.on("error", (err) => {
      this.logger.error(`迁移脚本 ${script} 启动失败: ${err.message}`);
      releaseLock();
      // spawn 失败时 createJobRow 已落下 pending 状态文件，不清理会永久锁死
      // 后续任务；这里把它落为 failed（exit 事件不一定触发）。
      void this.failStuckJobState(jobId, null).catch((caught) =>
        this.logger.warn(`处理启动失败状态失败: ${messageOf(caught)}`),
      );
    });
    child.on("exit", (code) => {
      releaseLock();
      this.logger.log(`迁移任务 ${jobId}（${script}）结束，exit=${code}`);
      void this.reconcileJobFromState(jobId).catch((caught) =>
        this.logger.warn(`回写迁移任务记录失败: ${messageOf(caught)}`),
      );
      // 异常退出时若状态文件仍停在 pending/running，落为 failed，避免 stale
      // 状态把后续任务永久锁死。
      void this.failStuckJobState(jobId, code).catch((caught) =>
        this.logger.warn(`处理异常退出状态失败: ${messageOf(caught)}`),
      );
    });
    child.unref();
  }

  /** 子进程结束后把状态文件回写到 MigrationJob 行（导入的初始行已被腾空）。 */
  private async reconcileJobFromState(jobId: string) {
    const state = await readJobState(this.paths.jobsDir, jobId);
    if (!state) return;
    await this.prisma.migrationJob.upsert({
      where: { id: jobId },
      create: {
        id: jobId,
        kind: state.kind,
        status: state.status,
        phase: state.phase,
        progress: state.progress as never,
        packageName: state.packageName,
        error: state.error,
        startedAt: state.startedAt ? new Date(state.startedAt) : null,
        finishedAt: state.finishedAt ? new Date(state.finishedAt) : null,
        // 导入重建后目标管理员已不存在于还原库，任务记录不关联用户。
        createdById: null,
      },
      update: {
        status: state.status,
        phase: state.phase,
        progress: state.progress as never,
        packageName: state.packageName,
        error: state.error,
        finishedAt: state.finishedAt ? new Date(state.finishedAt) : null,
      },
    });
  }

  private async readStateFiles(): Promise<Map<string, MigrationJobFileState>> {
    const map = new Map<string, MigrationJobFileState>();
    try {
      const entries = await readdir(this.paths.jobsDir, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const state = await readJobState(
          this.paths.jobsDir,
          entry.name.replace(/\.json$/, ""),
        );
        if (state) map.set(state.jobId, state);
      }
    } catch {
      // 目录不存在时返回空。
    }
    return map;
  }

  private async mergeJob(
    jobId: string,
    state: MigrationJobFileState | null,
    row: {
      id: string;
      kind: string;
      status: string;
      packageName: string | null;
      appVersion: string | null;
      manifest: unknown;
      progress: unknown;
      error: string | null;
      createdById: string | null;
      createdAt: Date;
      startedAt: Date | null;
      finishedAt: Date | null;
      updatedAt: Date;
    } | null,
  ): Promise<JobSummary> {
    return {
      id: jobId,
      kind: (state?.kind ?? row?.kind ?? "export") as "export" | "import",
      status: (state?.status ??
        row?.status ??
        "pending") as JobSummary["status"],
      phase: state?.phase ?? "",
      progress: state?.progress ?? null,
      packageName: state?.packageName ?? row?.packageName ?? null,
      appVersion: row?.appVersion ?? null,
      manifest: state?.manifest ?? row?.manifest ?? null,
      error: state?.error ?? row?.error ?? null,
      createdBy: row?.createdById ?? null,
      createdAt: row?.createdAt?.toISOString() ?? state?.startedAt ?? null,
      startedAt: state?.startedAt ?? row?.startedAt?.toISOString() ?? null,
      finishedAt: state?.finishedAt ?? row?.finishedAt?.toISOString() ?? null,
      updatedAt: state?.updatedAt ?? row?.updatedAt?.toISOString() ?? null,
    };
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSize(full);
      else
        total += await stat(full)
          .then((s) => s.size)
          .catch(() => 0);
    }
  } catch {
    // 忽略目录读取错误。
  }
  return total;
}
