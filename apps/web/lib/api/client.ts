export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function shouldRedirectToLogin(status: number, path: string) {
  return status === 401 && path !== "/auth/login";
}

export function redirectToLoginOnUnauthorized(status: number, path: string) {
  if (shouldRedirectToLogin(status, path) && typeof window !== "undefined") {
    window.location.replace("/login?reason=session-expired");
  }
}

export interface UploadRequestOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export function uploadFormData<T>(
  path: string,
  formData: FormData,
  fallbackMessage: string,
  options: UploadRequestOptions = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = () => {
      xhr.abort();
      finish(() => reject(new DOMException("上传已取消", "AbortError")));
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    xhr.open("POST", `${API_URL}${path}`);
    xhr.withCredentials = true;
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.(
        Math.min(100, Math.round((event.loaded / event.total) * 100)),
      );
    });
    xhr.addEventListener("load", () => {
      const body = parseJsonResponse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(100);
        finish(() => resolve(body as T));
        return;
      }

      redirectToLoginOnUnauthorized(xhr.status, path);
      const responseMessage =
        body && typeof body === "object" && "message" in body
          ? body.message
          : null;
      const message = Array.isArray(responseMessage)
        ? responseMessage.join("；")
        : typeof responseMessage === "string"
          ? responseMessage
          : fallbackMessage;
      finish(() => reject(new ApiError(message, xhr.status)));
    });
    xhr.addEventListener("error", () => {
      finish(() => reject(new Error("网络连接中断，请重新上传")));
    });
    xhr.addEventListener("abort", () => {
      finish(() => reject(new DOMException("上传已取消", "AbortError")));
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(formData);
  });
}

/**
 * 签名直入:浏览器 PUT 文件体到对象存储的预签名地址。
 * 预签名 URL 自带鉴权,不带 cookie;进度是真实的网络发送进度。
 * 失败时由调用方决定回退服务器中转,这里只报原始错误。
 */
export function putWithProgress(
  url: string,
  file: File,
  options: UploadRequestOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = () => {
      xhr.abort();
      finish(() => reject(new DOMException("上传已取消", "AbortError")));
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    xhr.open("PUT", url);
    if (file.type) {
      xhr.setRequestHeader("Content-Type", file.type);
    }
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.(
        Math.min(100, Math.round((event.loaded / event.total) * 100)),
      );
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(100);
        finish(() => resolve());
        return;
      }
      finish(() => reject(new Error(`直传对象存储失败(${xhr.status})`)));
    });
    xhr.addEventListener("error", () => {
      finish(() => reject(new Error("网络连接中断,直传对象存储失败")));
    });
    xhr.addEventListener("abort", () => {
      finish(() => reject(new DOMException("上传已取消", "AbortError")));
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(file);
  });
}

function parseJsonResponse(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join("；")
      : body?.message;

    redirectToLoginOnUnauthorized(response.status, path);

    throw new ApiError(message ?? "Request failed", response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
