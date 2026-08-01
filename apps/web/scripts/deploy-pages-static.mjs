import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PAGES_PROJECT = "liveboard-static";
const PRODUCTION_BRANCH = "main";
const EXPECTED_ASSET_ORIGIN = "https://static.hsfz.live";

const isVercelProduction =
  process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";

if (!isVercelProduction) {
  console.log(
    "[pages-static] 非 Vercel Production 构建，跳过 Cloudflare Pages 上传。",
  );
  process.exit(0);
}

const configuredAssetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX?.trim();
if (!configuredAssetPrefix) {
  console.log(
    "[pages-static] 未配置 NEXT_PUBLIC_ASSET_PREFIX，继续使用 Vercel 静态资源。",
  );
  process.exit(0);
}

const requiredVariables = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"];
const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]?.trim(),
);
if (missingVariables.length > 0) {
  throw new Error(
    `[pages-static] 缺少生产环境变量：${missingVariables.join(", ")}`,
  );
}

const assetPrefix = configuredAssetPrefix.replace(/\/+$/, "");
if (assetPrefix !== EXPECTED_ASSET_ORIGIN) {
  throw new Error(
    `[pages-static] NEXT_PUBLIC_ASSET_PREFIX 必须为 ${EXPECTED_ASSET_ORIGIN}。`,
  );
}

const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const sourceStaticDir = join(process.cwd(), distDir, "static");
if (!existsSync(sourceStaticDir)) {
  throw new Error(`[pages-static] 找不到 Next.js 静态目录：${sourceStaticDir}`);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN.trim();
if (!/^[a-f0-9]{32}$/i.test(accountId)) {
  throw new Error("[pages-static] CLOUDFLARE_ACCOUNT_ID 格式无效。");
}
const projectEndpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${PAGES_PROJECT}`;

const projectResponse = await fetch(projectEndpoint, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ production_branch: PRODUCTION_BRANCH }),
});
const projectResult = await projectResponse.json().catch(() => null);
if (!projectResponse.ok || projectResult?.success !== true) {
  throw new Error(
    `[pages-static] 无法确认 Pages Production branch（HTTP ${projectResponse.status}）。`,
  );
}

const stageDir = mkdtempSync(join(tmpdir(), "liveboard-pages-static-"));
try {
  const nextDir = join(stageDir, "_next");
  mkdirSync(nextDir, { recursive: true });
  cpSync(sourceStaticDir, join(nextDir, "static"), { recursive: true });
  writeFileSync(
    join(stageDir, "_headers"),
    "/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable\n",
    "utf8",
  );

  const args = [
    "exec",
    "wrangler",
    "pages",
    "deploy",
    stageDir,
    `--project-name=${PAGES_PROJECT}`,
    `--branch=${PRODUCTION_BRANCH}`,
  ];
  if (process.env.VERCEL_GIT_COMMIT_SHA?.trim()) {
    args.push(`--commit-hash=${process.env.VERCEL_GIT_COMMIT_SHA.trim()}`);
  }

  console.log("[pages-static] 正在上传当前 Next.js 构建的静态资源……");
  const result = spawnSync("pnpm", args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `[pages-static] Wrangler 上传失败（退出码 ${result.status ?? "unknown"}）。`,
    );
  }
  console.log(`[pages-static] 已发布到 ${EXPECTED_ASSET_ORIGIN}。`);
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
