import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { withRelatedProject } from "@vercel/related-projects";

/** @type {import('next').NextConfig} */
const createNextConfig = (phase) => {
  // Vercel 部署：通过 Related Projects 解析 `liveboard-api` 的对应环境
  // Host，缺失时回退 API_HOST。本地开发两者都未设置，因此不生成 rewrite，
  // NEXT_PUBLIC_API_URL 仍指向 http://localhost:4000。
  const isVercelPreview = process.env.VERCEL_ENV === "preview";
  const apiHost = withRelatedProject({
    projectName: "liveboard-api",
    // Preview 不允许回退到稳定的 Production API_HOST，避免预览环境读写正式库。
    defaultHost: isVercelPreview ? undefined : process.env.API_HOST,
  });

  if (isVercelPreview && !apiHost) {
    throw new Error(
      "Vercel Preview 缺少 liveboard-api Related Project；拒绝回退到 Production API_HOST。",
    );
  }

  return {
    distDir:
      process.env.NEXT_DIST_DIR ??
      (phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next"),
    reactStrictMode: true,
    transpilePackages: ["@liveboard/shared"],
    typedRoutes: true,
    async rewrites() {
      if (!apiHost) return [];
      const base = String(apiHost).replace(/\/$/, "");
      return [
        {
          source: "/api/:path*",
          destination: `${base}/:path*`,
        },
      ];
    },
  };
};

export default createNextConfig;
