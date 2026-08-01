const { spawnSync } = require("node:child_process");
const path = require("node:path");

const runtimeUrl = process.env.DATABASE_URL?.trim();
const directUrl = process.env.DIRECT_DATABASE_URL?.trim();
const databaseUrl = directUrl || runtimeUrl;

if (!databaseUrl) {
  console.error(
    "[db:deploy] 缺少 DIRECT_DATABASE_URL 或 DATABASE_URL，无法执行数据库迁移。",
  );
  process.exit(1);
}

if (!directUrl) {
  console.warn(
    "[db:deploy] 未设置 DIRECT_DATABASE_URL，将使用 DATABASE_URL；托管数据库建议为 migration 配置直连地址。",
  );
}

const prismaCli = path.resolve(
  __dirname,
  "../node_modules/prisma/build/index.js",
);
const schema = path.resolve(__dirname, "../prisma/schema.prisma");
const result = spawnSync(
  process.execPath,
  [prismaCli, "migrate", "deploy", "--schema", schema],
  {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[db:deploy] 无法启动 Prisma: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
