import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectRefKind } from "./migration-engine";

/**
 * 迁移包 manifest 结构与校验。格式见 docs/migrate-any-direction-design.md §4。
 */

export const MIGRATION_FORMAT_VERSION = 1;
/** 导入前管理员必须输入的确认语（可被 MIGRATION_IMPORT_CONFIRM_PHRASE 覆盖）。 */
export const DEFAULT_IMPORT_CONFIRM_PHRASE = "CONFIRM-IMPORT";

export interface ManifestMigration {
  name: string;
  checksum: string;
}

export interface ManifestObject {
  kind: ObjectRefKind;
  storageKey: string;
  /** 包内路径（objects/<n>-<清洗名>）；直推/直拉模式下缺省。 */
  path: string | null;
  /** 导出时 stat 的真实大小；导入校验唯一依据。 */
  sizeBytes: number;
  sha256: string;
  mimeType: string | null;
}

export interface MigrationManifest {
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  source: "server" | "vercel";
  dumpSha256: string;
  migrations: ManifestMigration[];
  /** 各业务表行数（除排除清单外全部表），导入后对账。 */
  tables: Record<string, number>;
  objects: ManifestObject[];
  options: { includeAiSecrets: boolean };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseManifest(raw: string): MigrationManifest {
  const parsed = JSON.parse(raw) as Partial<MigrationManifest>;
  if (
    parsed.formatVersion !== MIGRATION_FORMAT_VERSION ||
    typeof parsed.appVersion !== "string" ||
    typeof parsed.dumpSha256 !== "string" ||
    typeof parsed.source !== "string" ||
    !["server", "vercel"].includes(parsed.source) ||
    !Array.isArray(parsed.migrations) ||
    !parsed.migrations ||
    !Array.isArray(parsed.objects) ||
    !parsed.objects ||
    // tables 缺失/非对象必须在清空目标库前被发现（verifyImport 会遍历它）。
    !isPlainObject(parsed.tables) ||
    !isPlainObject(parsed.options)
  ) {
    throw new Error(
      `迁移包格式不受支持（formatVersion=${parsed.formatVersion ?? "?"}），期望版本 ${MIGRATION_FORMAT_VERSION}`,
    );
  }
  // 逐条校验元素形态：损坏/伪造的清单同样要在任何目标库改动前暴露。
  for (const [index, migration] of parsed.migrations.entries()) {
    if (
      typeof migration?.name !== "string" ||
      typeof migration?.checksum !== "string"
    ) {
      throw new Error(`迁移包清单 migrations[${index}] 格式不合法`);
    }
  }
  for (const [index, object] of parsed.objects.entries()) {
    if (
      typeof object?.kind !== "string" ||
      typeof object?.storageKey !== "string" ||
      typeof object?.sizeBytes !== "number" ||
      !Number.isFinite(object.sizeBytes) ||
      (object.path !== null && typeof object.path !== "string")
    ) {
      throw new Error(`迁移包清单 objects[${index}] 格式不合法`);
    }
  }
  return parsed as MigrationManifest;
}

export async function loadManifest(
  packageDir: string,
): Promise<MigrationManifest> {
  const raw = await readFile(path.join(packageDir, "manifest.json"), "utf8");
  return parseManifest(raw);
}
