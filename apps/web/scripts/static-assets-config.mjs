const SUPPORTED_PROVIDERS = new Set(["vercel", "cloudflare", "edgeone"]);

const readValue = (environment, name) => environment[name]?.trim() || undefined;

const normalizeOrigin = (value, variableName) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} 必须是有效的 HTTPS Origin。`);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `${variableName} 必须是没有凭据、路径、查询参数或锚点的 HTTPS Origin。`,
    );
  }

  return parsed.origin;
};

const readProjectName = (environment, name, fallback) => {
  const projectName = readValue(environment, name) || fallback;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(projectName)) {
    throw new Error(`${name} 格式无效。`);
  }
  return projectName;
};

export const resolveStaticAssetConfig = (environment = process.env) => {
  const requestedProvider = readValue(environment, "STATIC_ASSET_PROVIDER");
  const legacyAssetPrefix = readValue(environment, "NEXT_PUBLIC_ASSET_PREFIX");
  const provider =
    requestedProvider || (legacyAssetPrefix ? "cloudflare" : "vercel");

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(
      "STATIC_ASSET_PROVIDER 只能是 vercel、cloudflare 或 edgeone。",
    );
  }

  if (provider === "vercel") {
    return { provider, assetPrefix: undefined };
  }

  if (provider === "cloudflare") {
    const configuredOrigin =
      readValue(environment, "CLOUDFLARE_PAGES_ASSET_ORIGIN") ||
      legacyAssetPrefix;
    if (!configuredOrigin) {
      throw new Error(
        "STATIC_ASSET_PROVIDER=cloudflare 时必须设置 CLOUDFLARE_PAGES_ASSET_ORIGIN。",
      );
    }

    return {
      provider,
      assetPrefix: normalizeOrigin(
        configuredOrigin,
        "CLOUDFLARE_PAGES_ASSET_ORIGIN",
      ),
      projectName: readProjectName(
        environment,
        "CLOUDFLARE_PAGES_PROJECT",
        "liveboard-static",
      ),
      productionBranch:
        readValue(environment, "CLOUDFLARE_PAGES_PRODUCTION_BRANCH") || "main",
    };
  }

  const configuredOrigin = readValue(environment, "EDGEONE_ASSET_ORIGIN");
  if (!configuredOrigin) {
    throw new Error(
      "STATIC_ASSET_PROVIDER=edgeone 时必须设置 EDGEONE_ASSET_ORIGIN。",
    );
  }

  return {
    provider,
    assetPrefix: normalizeOrigin(configuredOrigin, "EDGEONE_ASSET_ORIGIN"),
    projectName: readProjectName(
      environment,
      "EDGEONE_PROJECT_NAME",
      "liveboard-static-eo",
    ),
  };
};
