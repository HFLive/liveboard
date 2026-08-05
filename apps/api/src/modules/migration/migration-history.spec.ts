import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BASELINE_MIGRATION,
  EXCLUDED_MIGRATION_TABLES,
  excludeTableDataArgs,
  normalizeBundledMigrations,
  sha256File,
  type MigrationRecord,
} from "./migration-history";

describe("migration-history normalizeBundledMigrations", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "migration-history-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function addMigration(
    name: string,
    sql: string,
  ): Promise<{ name: string; checksum: string }> {
    const folder = path.join(dir, name);
    await mkdir(folder);
    const file = path.join(folder, "migration.sql");
    await writeFile(file, sql, "utf8");
    return { name, checksum: await sha256File(file) };
  }

  const baseline = () => ({ name: BASELINE_MIGRATION, checksum: "ignored" });

  it("保留有文件夹的迁移，并校验 checksum", async () => {
    const bundled = await addMigration(BASELINE_MIGRATION, "-- baseline");
    const result = await normalizeBundledMigrations([bundled], dir, true);
    expect(result.migrations).toEqual([bundled]);
    expect(result.skippedLegacy).toBe(0);
  });

  it("verifyChecksums=false 时不做 checksum 校验（导出侧）", async () => {
    const bundled = await addMigration(BASELINE_MIGRATION, "-- baseline");
    const wrong = { name: bundled.name, checksum: "ffff".repeat(16) };
    const result = await normalizeBundledMigrations([wrong], dir, false);
    expect(result.migrations).toEqual([wrong]);
  });

  it("文件夹存在但 checksum 不符时 fail-closed（导入侧）", async () => {
    const bundled = await addMigration(BASELINE_MIGRATION, "-- baseline");
    const wrong = { name: bundled.name, checksum: "ffff".repeat(16) };
    await expect(
      normalizeBundledMigrations([wrong], dir, true),
    ).rejects.toThrow(/checksum/);
  });

  it("无文件夹的旧历史在有 baseline 覆盖时跳过", async () => {
    const bundled = await addMigration(BASELINE_MIGRATION, "-- baseline");
    const legacy: MigrationRecord = {
      name: "20260712130736_initial",
      checksum: "ffff".repeat(16),
    };
    const result = await normalizeBundledMigrations(
      [legacy, bundled],
      dir,
      true,
    );
    expect(result.migrations).toEqual([bundled]);
    expect(result.skippedLegacy).toBe(1);
  });

  it("无文件夹且无 baseline 覆盖时 fail-closed（目标版本不兼容）", async () => {
    const legacy: MigrationRecord = {
      name: "20260712130736_initial",
      checksum: "ffff".repeat(16),
    };
    await expect(
      normalizeBundledMigrations([legacy], dir, true),
    ).rejects.toThrow(/目标应用缺少 migration/);
  });

  it("拒绝含 `../` 的 migration 名，防止路径越界", async () => {
    await addMigration(BASELINE_MIGRATION, "-- baseline");
    const evil: MigrationRecord = {
      name: "../../etc",
      checksum: "ffff".repeat(16),
    };
    await expect(
      normalizeBundledMigrations([evil, baseline()], dir, true),
    ).rejects.toThrow(/不合法/);
  });
});

describe("migration-history excludeTableDataArgs", () => {
  it("为混合大小写表名生成带引号的 pg_dump 排除参数", () => {
    const args = excludeTableDataArgs();
    expect(EXCLUDED_MIGRATION_TABLES).toHaveLength(4);
    // 带引号：pg_dump 模式不带引号会被折叠为小写，匹配不到 "PendingUpload" 等
    expect(args).toContain('--exclude-table-data="PendingUpload"');
    expect(args).toContain('--exclude-table-data="ServerMetricSample"');
    expect(args).toContain('--exclude-table-data="MigrationJob"');
    expect(args).toContain('--exclude-table-data="_prisma_migrations"');
    // 裸名（不带引号）是折叠小写匹配不到的旧写法，回归防它复活
    expect(args.some((a) => a === "--exclude-table-data=PendingUpload")).toBe(
      false,
    );
  });
});
