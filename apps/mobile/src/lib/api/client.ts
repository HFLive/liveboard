export const MOBILE_CLIENT_HEADER = "X-LiveBoard-Client";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function readApiErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const message = "message" in body ? body.message : null;
  if (Array.isArray(message)) {
    return (
      message.filter((item) => typeof item === "string").join("；") || fallback
    );
  }
  return typeof message === "string" && message.trim() ? message : fallback;
}

let currentBaseUrl = "";
let currentSessionToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function configureApiClient(input: {
  baseUrl: string;
  sessionToken?: string | null;
}) {
  currentBaseUrl = input.baseUrl.replace(/\/+$/, "");
  if ("sessionToken" in input) {
    currentSessionToken = input.sessionToken ?? null;
  }
}

export function setApiUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export function getApiBaseUrl() {
  return currentBaseUrl;
}

export function getSessionToken() {
  return currentSessionToken;
}

export function apiUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${currentBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function authHeaders(extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {
    [MOBILE_CLIENT_HEADER]: "mobile",
  };
  if (currentSessionToken) {
    headers.Authorization = `Bearer ${currentSessionToken}`;
  }
  if (extra) {
    const fromExtra = new Headers(extra);
    fromExtra.forEach((value, key) => {
      headers[key] = value;
    });
  }
  return headers;
}

const PUBLIC_AUTH_PATHS = new Set([
  "/auth/login",
  "/auth/breakglass/login",
  "/auth/config",
]);

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = authHeaders(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
  });

  if (
    response.status === 401 &&
    !PUBLIC_AUTH_PATHS.has(path.split("?")[0] ?? path)
  ) {
    unauthorizedHandler?.();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      readApiErrorMessage(body, `请求失败（${response.status}）`),
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function requestBlob(path: string, init: RequestInit = {}) {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: authHeaders(init.headers),
  });
  if (response.status === 401) {
    unauthorizedHandler?.();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      readApiErrorMessage(body, `无法加载文件（${response.status}）`),
      response.status,
    );
  }
  return response;
}
