const DEFAULT_API_URL = "http://localhost:4000";

export function defaultServerUrl() {
  return process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_API_URL;
}

export function normalizeServerUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("请填写服务器地址");
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("服务器地址无效");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只支持 http 或 https 地址");
  }

  parsed.hash = "";
  parsed.search = "";
  const normalized = parsed.toString().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("服务器地址无效");
  }
  return normalized;
}

export function isLikelyLocalHost(url: string) {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
