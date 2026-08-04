/**
 * 独立校验器：把迁移包应用到目标后，对照 manifest 校验目标部署。
 * 也可由 migrate-import 在导入成功后内部调用。
 *
 * 用法：
 *   tsx scripts/migrate-verify.ts --source <包目录或.tar> [--job-id <id>]
 */
import { PrismaClient } from "@prisma/client";
import { loadManifest } from "../src/modules/migration/migration-manifest";
import {
  formatVerifyResult,
  verifyImport,
} from "../src/modules/migration/migration-verify";
import { messageOf } from "../src/modules/migration/migration-engine";
import { writeJobState } from "../src/modules/migration/migration-job-file";
import { migrationDataDir } from "./migrate-cli";
import { createTargetActiveBackend } from "./migrate-backends";
import { resolvePackageDir } from "./migrate-package";
import path from "node:path";

interface Args {
  jobId: string | null;
  source: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { jobId: null, source: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--job-id") args.jobId = argv[++index] ?? null;
    else if (arg === "--source") args.source = argv[++index] ?? "";
  }
  if (!args.source) throw new Error("缺少 --source");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // jobId 会拼进临时目录名并参与 rm -rf：必须先按与 jobStatePath 相同的规则校验，
  // 防止 `../` 路径穿越越界删除（resolvePackageDir 的 rm 在首次校验之前执行）。
  if (args.jobId !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(args.jobId)) {
    throw new Error(`无效的迁移任务 ID: ${args.jobId}`);
  }
  const prisma = new PrismaClient();
  let packageInfo: { packageDir: string; cleanup: () => Promise<void> } | null =
    null;
  try {
    packageInfo = await resolvePackageDir(
      args.source,
      migrationDataDir(),
      `verify-${args.jobId ?? "manual"}`,
    );
    const manifest = await loadManifest(packageInfo.packageDir);
    const target = await createTargetActiveBackend(prisma);
    const result = await verifyImport({
      prisma,
      manifest,
      targetBackend: target.backend,
      targetBackendName: target.name,
    });
    for (const line of formatVerifyResult(result)) console.log(line);

    if (args.jobId) {
      const jobsDir = path.join(migrationDataDir(), "jobs");
      if (result.blocking) {
        await writeJobState(jobsDir, args.jobId, {
          status: "failed",
          phase: "verify",
          error: "导入后校验未通过",
          finishedAt: new Date().toISOString(),
        });
      } else {
        await writeJobState(jobsDir, args.jobId, {
          status: "succeeded",
          phase: "verify",
          finishedAt: new Date().toISOString(),
        });
      }
    }
    if (result.blocking) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await packageInfo?.cleanup().catch(() => undefined);
  }
}

main().catch((caught) => {
  console.error(`[verify] 执行失败：${messageOf(caught)}`);
  process.exitCode = 1;
});
