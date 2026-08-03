import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { resolveStaticAssetConfig } from "./static-assets-config.mjs";

const isVercelProduction =
  process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";

if (!isVercelProduction) {
  console.log(
    "[static-assets] 非 Vercel Production 构建，跳过外部静态资源上传。",
  );
  process.exit(0);
}

const config = resolveStaticAssetConfig();
if (config.provider === "vercel") {
  console.log("[static-assets] 使用 Vercel 原生静态资源，跳过外部上传。");
  process.exit(0);
}

const requireVariables = (names) => {
  const missingVariables = names.filter((name) => !process.env[name]?.trim());
  if (missingVariables.length > 0) {
    throw new Error(
      `[static-assets] 缺少 ${config.provider} 生产环境变量：${missingVariables.join(", ")}`,
    );
  }
};

const run = (command, args, failureLabel) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `[static-assets] ${failureLabel}（退出码 ${result.status ?? "unknown"}）。`,
    );
  }
};

const findFirstFile = (directory, matches = () => true) => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nestedFile = findFirstFile(entryPath, matches);
      if (nestedFile) return nestedFile;
    } else if (entry.isFile() && matches(entryPath)) {
      return entryPath;
    }
  }
  return undefined;
};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isJavaScriptContentType = (value) =>
  /^(?:application|text)\/(?:javascript|ecmascript)(?:\s*;|$)/i.test(
    value || "",
  );

const verifyPublishedAsset = async (sourceStaticDir, distDir) => {
  const buildIdPath = join(process.cwd(), distDir, "BUILD_ID");
  const buildId = existsSync(buildIdPath)
    ? readFileSync(buildIdPath, "utf8").trim()
    : undefined;
  const buildManifest = buildId
    ? join(sourceStaticDir, buildId, "_buildManifest.js")
    : undefined;
  const localFile =
    buildManifest && existsSync(buildManifest)
      ? buildManifest
      : findFirstFile(sourceStaticDir);
  if (!localFile) {
    throw new Error("[static-assets] Next.js 静态目录中没有可验证的文件。");
  }

  // 仅验证构建清单文件（含 JavaScript MIME 检查）。若构建中仍存在 .mjs 模块文件，
  // 一并验证其 MIME，但不强制要求存在——PDF worker 改由 Web 站点从 public/ 提供，
  // 不再进入 EdgeOne 的 /_next/static，避免了 EdgeOne 对 .mjs 的类型问题。
  const verificationFiles = [localFile];
  const moduleFile = findFirstFile(sourceStaticDir, (entryPath) =>
    entryPath.endsWith(".mjs"),
  );
  if (moduleFile && moduleFile !== localFile) {
    verificationFiles.push(moduleFile);
  }

  for (const verificationFile of verificationFiles) {
    const relativePath = relative(sourceStaticDir, verificationFile)
      .split(sep)
      .join("/");
    const expectedContent = readFileSync(verificationFile);
    const verificationUrl = new URL(
      `/_next/static/${relativePath}`,
      config.assetPrefix,
    );
    verificationUrl.searchParams.set(
      "liveboard-deployment",
      process.env.VERCEL_GIT_COMMIT_SHA?.trim() || Date.now().toString(),
    );
    const requiresJavaScriptContentType = /\.m?js$/i.test(verificationFile);

    let lastFailure = "unknown";
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        const response = await fetch(verificationUrl, {
          headers: { "Cache-Control": "no-cache" },
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const contentType = response.headers.get("content-type");
          if (
            requiresJavaScriptContentType &&
            !isJavaScriptContentType(contentType)
          ) {
            lastFailure = `Content-Type 不是 JavaScript MIME（${contentType || "缺失"}）`;
          } else {
            const actualContent = Buffer.from(await response.arrayBuffer());
            if (actualContent.equals(expectedContent)) {
              console.log(
                `[static-assets] 已通过正式域名校验：/_next/static/${relativePath}`,
              );
              break;
            }
            lastFailure = "文件内容与本次构建不一致";
          }
        } else {
          lastFailure = `HTTP ${response.status}`;
        }
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }

      if (attempt === 6) {
        throw new Error(
          `[static-assets] ${config.assetPrefix} 未能正确提供本次构建文件 /_next/static/${relativePath}：${lastFailure}`,
        );
      }
      await wait(3_000);
    }
  }
};

if (config.provider === "cloudflare") {
  requireVariables(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
} else {
  requireVariables(["EDGEONE_API_TOKEN"]);
}

const deployToCloudflare = async (stageDir) => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID.trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("[static-assets] CLOUDFLARE_ACCOUNT_ID 格式无效。");
  }

  const projectEndpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(config.projectName)}`;
  const projectResponse = await fetch(projectEndpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ production_branch: config.productionBranch }),
  });
  const projectResult = await projectResponse.json().catch(() => null);
  if (!projectResponse.ok || projectResult?.success !== true) {
    throw new Error(
      `[static-assets] 无法确认 Cloudflare Pages Production branch（HTTP ${projectResponse.status}）。`,
    );
  }

  const args = [
    "exec",
    "wrangler",
    "pages",
    "deploy",
    stageDir,
    `--project-name=${config.projectName}`,
    `--branch=${config.productionBranch}`,
  ];
  if (process.env.VERCEL_GIT_COMMIT_SHA?.trim()) {
    args.push(`--commit-hash=${process.env.VERCEL_GIT_COMMIT_SHA.trim()}`);
  }
  run("pnpm", args, "Wrangler 上传失败");
};

const deployToEdgeOne = (stageDir) => {
  run(
    "pnpm",
    [
      "dlx",
      "edgeone@1.6.19",
      "makers",
      "deploy",
      stageDir,
      "--name",
      config.projectName,
      "--token",
      process.env.EDGEONE_API_TOKEN.trim(),
      "--env",
      "production",
      "--area",
      "overseas",
    ],
    "EdgeOne Makers 上传失败",
  );
};

const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const sourceStaticDir = join(process.cwd(), distDir, "static");
if (!existsSync(sourceStaticDir)) {
  throw new Error(
    `[static-assets] 找不到 Next.js 静态目录：${sourceStaticDir}`,
  );
}

const stageDir = mkdtempSync(join(tmpdir(), "liveboard-static-assets-"));
try {
  const nextDir = join(stageDir, "_next");
  mkdirSync(nextDir, { recursive: true });
  cpSync(sourceStaticDir, join(nextDir, "static"), { recursive: true });

  if (config.provider === "cloudflare") {
    writeFileSync(
      join(stageDir, "_headers"),
      "/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable\n  Access-Control-Allow-Origin: *\n  Cross-Origin-Resource-Policy: cross-origin\n",
      "utf8",
    );
  } else {
    const staticAssetHeaders = [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
      { key: "Access-Control-Allow-Origin", value: "*" },
      {
        key: "Cross-Origin-Resource-Policy",
        value: "cross-origin",
      },
    ];

    writeFileSync(
      join(stageDir, "index.html"),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>LiveBoard Static Assets</title></head><body>LiveBoard static asset host.</body></html>\n',
      "utf8",
    );
    writeFileSync(
      join(stageDir, "edgeone.json"),
      `${JSON.stringify(
        {
          headers: [
            {
              source: "/_next/static/*.mjs",
              headers: [
                ...staticAssetHeaders,
                {
                  key: "Content-Type",
                  value: "application/javascript; charset=utf-8",
                },
              ],
            },
            {
              source: "/_next/static/*",
              headers: staticAssetHeaders,
            },
            {
              source: "/",
              headers: [{ key: "Cache-Control", value: "no-store" }],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  console.log(
    `[static-assets] 正在把当前 Next.js 构建上传到 ${config.provider}……`,
  );
  if (config.provider === "cloudflare") {
    await deployToCloudflare(stageDir);
  } else {
    deployToEdgeOne(stageDir);
  }
  await verifyPublishedAsset(sourceStaticDir, distDir);
  console.log(`[static-assets] 已发布到 ${config.assetPrefix}。`);
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
