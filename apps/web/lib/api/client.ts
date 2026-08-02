import type { ObjectUploadInstruction } from "@liveboard/shared";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 前端部署目标。Vercel 构建时设置为 `vercel`；缺失时保持 `self_hosted`。
 * 只用于决定直传失败时是否允许回退到服务器中转，不携带任何凭据。
 */
export const DEPLOYMENT_TARGET: "self_hosted" | "vercel" =
  process.env.NEXT_PUBLIC_DEPLOYMENT_TARGET === "vercel"
    ? "vercel"
    : "self_hosted";

/** 单个文件最多同时上传 4 个分片；文件任务本身仍由队列限制为最多 2 个。 */
const MAX_MULTIPART_PART_CONCURRENCY = 4;

/** Vercel 下禁止直传失败后回退到 API multipart 中转。 */
export const ALLOW_RELAY_FALLBACK = DEPLOYMENT_TARGET !== "vercel";

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
 * 对象存储单请求直传：只设置服务端签发的允许 Header，进度是浏览器真实的
 * 网络发送进度。大文件由 uploadToObjectStorage 进一步拆成多个这样的 PUT。
 */
export function putToObjectStorageWithProgress(
  url: string,
  headers: Record<string, string>,
  file: Blob,
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
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
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

/**
 * 签名直入:浏览器按服务端签发的 POST Policy 上传一个完整的小文件。
 * Policy 在 OSS 侧强制校验对象 Key、精确大小与 MIME；file 必须最后
 * 加入表单。请求不带站点 cookie，进度是真实的网络发送进度。
 */
export function postToObjectStorageWithProgress(
  url: string,
  fields: Record<string, string>,
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

    xhr.open("POST", url);
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
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      formData.append(name, value);
    }
    formData.append("file", file);
    xhr.send(formData);
  });
}

/**
 * 按上传指令判别联合把文件传到对象存储或统一 multipart API：
 * - `form_post`：OSS 的 HTML Form POST Policy。
 * - `put`：R2 的预签名 PUT。
 * - `multipart`：按 8MiB 分片有限并发上传，确认请求负责完成 multipart 对象。
 */
export async function uploadToObjectStorage(
  instruction: ObjectUploadInstruction,
  uploadId: string,
  file: File,
  options: UploadRequestOptions = {},
): Promise<void> {
  if (instruction.transport === "multipart") {
    return uploadMultipartWithProgress(instruction, uploadId, file, options);
  }
  if (instruction.transport === "put") {
    return putToObjectStorageWithProgress(
      instruction.url,
      instruction.headers ?? {},
      file,
      options,
    );
  }
  return postToObjectStorageWithProgress(
    instruction.url,
    instruction.fields ?? {},
    file,
    options,
  );
}

function putToApiWithProgress(
  uploadId: string,
  partNumber: number,
  part: Blob,
  options: UploadRequestOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const path = `/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}`;

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

    xhr.open("PUT", `${API_URL}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
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
      const body = parseJsonResponse(xhr.responseText) as {
        message?: string | string[];
      } | null;
      const message = Array.isArray(body?.message)
        ? body.message.join("；")
        : body?.message;
      redirectToLoginOnUnauthorized(xhr.status, path);
      finish(() =>
        reject(
          new ApiError(message ?? `上传分片失败(${xhr.status})`, xhr.status),
        ),
      );
    });
    xhr.addEventListener("error", () => {
      finish(() => reject(new Error("网络连接中断，请重新上传")));
    });
    xhr.addEventListener("abort", () => {
      finish(() => reject(new DOMException("上传已取消", "AbortError")));
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(part);
  });
}

async function uploadMultipartWithProgress(
  instruction: Extract<ObjectUploadInstruction, { transport: "multipart" }>,
  uploadId: string,
  file: File,
  options: UploadRequestOptions,
) {
  const partProgress = new Map<number, number>();
  const partController = new AbortController();
  let nextPartNumber = 1;

  const abortParts = () => partController.abort();
  if (options.signal?.aborted) {
    throw new DOMException("上传已取消", "AbortError");
  }
  options.signal?.addEventListener("abort", abortParts, { once: true });

  const reportProgress = (partNumber: number, loaded: number) => {
    partProgress.set(
      partNumber,
      Math.min(
        file.size,
        Math.max(0, Math.min(instruction.partSizeBytes, loaded)),
      ),
    );
    const uploadedBytes = [...partProgress.values()].reduce(
      (total, value) => total + value,
      0,
    );
    options.onProgress?.(
      Math.min(100, Math.round((uploadedBytes / file.size) * 100)),
    );
  };

  const uploadPart = async (partNumber: number) => {
    const start = (partNumber - 1) * instruction.partSizeBytes;
    const end = Math.min(file.size, start + instruction.partSizeBytes);
    const part = file.slice(start, end);
    const onPartProgress = (progress: number) =>
      reportProgress(partNumber, (part.size * progress) / 100);

    if (instruction.mode === "direct") {
      const signed = await request<{
        url: string;
        headers: Record<string, string>;
      }>(`/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}/url`, {
        method: "POST",
        body: JSON.stringify({ sizeBytes: part.size }),
        signal: partController.signal,
      });
      await putToObjectStorageWithProgress(signed.url, signed.headers, part, {
        signal: partController.signal,
        onProgress: onPartProgress,
      });
    } else {
      await putToApiWithProgress(uploadId, partNumber, part, {
        signal: partController.signal,
        onProgress: onPartProgress,
      });
    }

    reportProgress(partNumber, part.size);
  };

  const worker = async () => {
    while (true) {
      const partNumber = nextPartNumber;
      nextPartNumber += 1;
      if (partNumber > instruction.partCount) return;
      await uploadPart(partNumber);
    }
  };

  try {
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            MAX_MULTIPART_PART_CONCURRENCY,
            instruction.partCount,
          ),
        },
        () => worker(),
      ),
    );
  } catch (caught) {
    partController.abort();
    throw caught;
  } finally {
    options.signal?.removeEventListener("abort", abortParts);
  }
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
