import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * 迁移脚本共享助手：pg 连接解析、pg 工具调用、prisma resolve、路径解析。
 *
 * 注意：导入/导出使用直连连接串（DIRECT_DATABASE_URL 优先），与
 * docs/deploy-vercel-r2.md 的约定一致；pg 工具用 libpq 环境变量传密码，
 * 避免连接串出现在进程列表。
 */

export interface PostgresConnection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  /** 连接串 query 中的 ?sslmode=；未指定时为 null，回落环境变量/默认值。 */
  sslmode: string | null;
}

export function parsePostgresUrl(url: string): PostgresConnection {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "");
  if (!parsed.hostname || !database) {
    throw new Error("无效的 PostgreSQL 连接串");
  }
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    sslmode: parsed.searchParams.get("sslmode"),
  };
}

/** pg_dump/pg_restore/psql 的通用连接参数（-h -p -U），另附数据库名。 */
export function pgConnectionArgs(conn: PostgresConnection): string[] {
  return ["-h", conn.host, "-p", conn.port, "-U", conn.user];
}

/** 迁移/还原用直连地址：DIRECT_DATABASE_URL 优先，回退 DATABASE_URL。 */
export function databaseUrlForTools(): string {
  const direct = process.env.DIRECT_DATABASE_URL?.trim();
  const runtime = process.env.DATABASE_URL?.trim();
  const value = direct || runtime;
  if (!value) {
    throw new Error("缺少 DIRECT_DATABASE_URL 或 DATABASE_URL");
  }
  return value;
}

/** 迁移数据目录（与 API 的 MIGRATION_DATA_DIR 一致）。 */
export function migrationDataDir(): string {
  return process.env.MIGRATION_DATA_DIR?.trim() || "/data/migration";
}

/** 运行 pg 工具，密码经 PGPASSWORD 传递，输出直通。返回退出码（0 为成功）。 */
export function runPgTool(
  command: "pg_dump" | "pg_restore" | "psql",
  args: string[],
  databaseUrl: string,
): number {
  const conn = parsePostgresUrl(databaseUrl);
  const result = spawnSync(command, args, {
    env: {
      ...process.env,
      PGPASSWORD: conn.password,
      // 优先级：显式环境变量 > 连接串 ?sslmode= > 默认 prefer。
      // 连接串里写了 require 却回落 prefer 会静默降级为不加密传输。
      PGSSLMODE: process.env.PGSSLMODE ?? conn.sslmode ?? "prefer",
    },
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(
      `无法启动 ${command}（请确认已安装 postgresql-client）: ${result.error.message}`,
    );
  }
  return result.status ?? 1;
}

/** 当前应用版本（apps/api/package.json），manifest 与 fail-closed 校验用。 */
export function appVersion(): string {
  // tsx/CommonJS 下 require 可用；路径相对本脚本（scripts/）解析。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require("../package.json") as { version?: string };
  return pkg.version ?? "0.0.0";
}

/** 目标应用 prisma/migrations 目录（相对本脚本解析，与运行时 cwd 无关）。 */
export function targetMigrationsDir(): string {
  return path.join(__dirname, "..", "prisma", "migrations");
}

/** prisma CLI 的 Node 入口（与 docker-compose migrate 服务用法一致）。 */
export function prismaCliPath(): string {
  return path.join(
    __dirname,
    "..",
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
}

/** `prisma migrate resolve --applied <name>`：把还原后的迁移历史逐条标记。 */
export function runPrismaResolve(
  migrationName: string,
  databaseUrl: string,
): number {
  const schema = path.join(__dirname, "..", "prisma", "schema.prisma");
  const result = spawnSync(
    process.execPath,
    [
      prismaCliPath(),
      "migrate",
      "resolve",
      "--applied",
      migrationName,
      "--schema",
      schema,
    ],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw new Error(`无法启动 prisma migrate resolve: ${result.error.message}`);
  }
  return result.status ?? 1;
}
