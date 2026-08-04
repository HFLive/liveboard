import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * 迁移历史归一化（导出/导入共用）。
 *
 * 仓库收口为单 baseline 后，应用只打包 `00000000000000_baseline_v1` 及其后续增量
 * migration 文件夹；但过渡库的 `_prisma_migrations` 仍保留被 baseline 合并的旧
 * 历史记录（那 41 条文件夹已不打包）。导出时若原样记录这些旧历史，导入端无法
 * 逐条校验/resolve，必然 fail-closed。这里统一把历史归一化到"应用打包的迁移集"：
 *   - 有对应文件夹的迁移保留（导入端校验 checksum）；
 *   - 无文件夹、但清单含 baseline → 跳过（旧历史，schema 已并入 baseline）；
 *   - 无文件夹、且无 baseline 覆盖 → 抛错（目标版本不兼容 / 未过渡源），fail-closed。
 */

export interface MigrationRecord {
  name: string;
  checksum: string;
}

/** 单 baseline 收口后的基线迁移名；旧历史记录（文件夹已不打包）都并入它。 */
export const BASELINE_MIGRATION = "00000000000000_baseline_v1";

/** 迁移名安全字符：来自不受信的 manifest，必须防 `../` 借 path.join 越界。 */
const MIGRATION_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** 应用打包的 prisma/migrations 目录里是否存在该迁移文件夹。 */
export async function hasMigrationFolder(
  migrationsDir: string,
  name: string,
): Promise<boolean> {
  try {
    const info = await stat(path.join(migrationsDir, name));
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

export interface NormalizeMigrationsResult {
  /** 保留的迁移（有文件夹；checksum 已在 verifyChecksums 时校验）。 */
  migrations: MigrationRecord[];
  /** 因并入 baseline 而跳过的旧历史记录数。 */
  skippedLegacy: number;
}

export async function normalizeBundledMigrations(
  migrations: MigrationRecord[],
  migrationsDir: string,
  verifyChecksums: boolean,
): Promise<NormalizeMigrationsResult> {
  const hasBaseline = migrations.some((m) => m.name === BASELINE_MIGRATION);
  const kept: MigrationRecord[] = [];
  let skippedLegacy = 0;
  for (const migration of migrations) {
    if (!MIGRATION_NAME_PATTERN.test(migration.name)) {
      throw new Error(
        `迁移包 migration 名不合法，拒绝导入（fail-closed）：${migration.name}`,
      );
    }
    if (!(await hasMigrationFolder(migrationsDir, migration.name))) {
      if (!hasBaseline) {
        throw new Error(
          `目标应用缺少 migration ${migration.name}，与本迁移包版本不一致，拒绝导入（fail-closed）。` +
            `请先把目标升级到与源一致的版本，或对 dump 执行离线升级流程后重新打包。`,
        );
      }
      // 单 baseline 已合并的旧历史：跳过，schema 已并入 baseline。
      skippedLegacy += 1;
      continue;
    }
    if (verifyChecksums) {
      const actual = await sha256File(
        path.join(migrationsDir, migration.name, "migration.sql"),
      );
      if (actual !== migration.checksum) {
        throw new Error(
          `migration ${migration.name} 的 checksum 与迁移包不一致，拒绝导入（fail-closed）。`,
        );
      }
    }
    kept.push(migration);
  }
  return { migrations: kept, skippedLegacy };
}
