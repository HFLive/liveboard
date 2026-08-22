import type {
  ObjectUploadInstruction,
  SignedUploadResponse,
} from "@liveboard/shared";
import { ApiError, apiUrl, authHeaders, request } from "./client";
import type { LocalUploadFile } from "./types";

export interface UploadProgressOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

function asNativeFile(file: LocalUploadFile) {
  return {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || "application/octet-stream",
  } as unknown as Blob;
}

function xhrSend(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit | null,
  headers: Record<string, string>,
  options: UploadProgressOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => {
      xhr.abort();
      finish(() => reject(new Error("上传已取消")));
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    xhr.open(method, url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
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
        finish(() => resolve(xhr.responseText));
        return;
      }
      finish(() =>
        reject(new ApiError(`上传失败（${xhr.status}）`, xhr.status)),
      );
    });
    xhr.addEventListener("error", () => {
      finish(() => reject(new Error("网络连接中断，请重新上传")));
    });
    xhr.addEventListener("abort", () => {
      finish(() => reject(new Error("上传已取消")));
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(body);
  });
}

export async function uploadFormFile<T>(
  path: string,
  file: LocalUploadFile,
  extraFields: Record<string, string> = {},
  fieldName = "file",
  options: UploadProgressOptions = {},
) {
  const form = new FormData();
  form.append(fieldName, asNativeFile(file));
  for (const [key, value] of Object.entries(extraFields)) {
    form.append(key, value);
  }
  const text = await xhrSend(
    "POST",
    apiUrl(path),
    form,
    authHeaders(),
    options,
  );
  return JSON.parse(text) as T;
}

async function putFile(
  url: string,
  headers: Record<string, string>,
  file: LocalUploadFile,
  options: UploadProgressOptions,
) {
  await xhrSend(
    "PUT",
    url,
    asNativeFile(file) as XMLHttpRequestBodyInit,
    headers,
    options,
  );
}

async function postFormToStorage(
  url: string,
  fields: Record<string, string>,
  file: LocalUploadFile,
  options: UploadProgressOptions,
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  form.append("file", asNativeFile(file));
  await xhrSend("POST", url, form, {}, options);
}

export async function uploadToObjectStorage(
  instruction: ObjectUploadInstruction,
  uploadId: string,
  file: LocalUploadFile,
  options: UploadProgressOptions = {},
) {
  if (instruction.transport === "put") {
    await putFile(instruction.url, instruction.headers ?? {}, file, options);
    return;
  }
  if (instruction.transport === "form_post") {
    await postFormToStorage(
      instruction.url,
      instruction.fields ?? {},
      file,
      options,
    );
    return;
  }

  const partSize = instruction.partSizeBytes;
  for (
    let partNumber = 1;
    partNumber <= instruction.partCount;
    partNumber += 1
  ) {
    const start = (partNumber - 1) * partSize;
    const end = Math.min(file.size, start + partSize);
    const response = await fetch(file.uri);
    const blob = await response.blob();
    const part = blob.slice(start, end);
    options.onProgress?.(
      Math.min(100, Math.round((end / Math.max(file.size, 1)) * 100)),
    );

    if (instruction.mode === "direct") {
      const signed = await request<{
        url: string;
        headers: Record<string, string>;
      }>(`/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}/url`, {
        method: "POST",
        body: JSON.stringify({ sizeBytes: end - start }),
        signal: options.signal,
      });
      await xhrSend("PUT", signed.url, part, signed.headers, {
        signal: options.signal,
      });
    } else {
      await xhrSend(
        "PUT",
        apiUrl(`/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}`),
        part,
        authHeaders({ "Content-Type": "application/octet-stream" }),
        { signal: options.signal },
      );
    }
  }
}

export async function uploadWithSignedProtocol<T>(input: {
  signPath: string;
  confirmPath: string;
  abortPath: string;
  relayPath: string;
  file: LocalUploadFile;
  signBody: Record<string, unknown>;
  extraRelayFields?: Record<string, string>;
  options?: UploadProgressOptions;
}) {
  let signed: SignedUploadResponse;
  try {
    signed = await request<SignedUploadResponse>(input.signPath, {
      method: "POST",
      body: JSON.stringify(input.signBody),
    });
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 501) {
      return uploadFormFile<T>(
        input.relayPath,
        input.file,
        input.extraRelayFields,
        "file",
        input.options,
      );
    }
    throw caught;
  }

  try {
    await uploadToObjectStorage(
      signed.instruction,
      signed.uploadId,
      input.file,
      input.options,
    );
  } catch (caught) {
    await request<{ ok: boolean }>(input.abortPath, {
      method: "POST",
      body: JSON.stringify({ uploadId: signed.uploadId }),
    }).catch(() => undefined);
    return uploadFormFile<T>(
      input.relayPath,
      input.file,
      input.extraRelayFields,
      "file",
      input.options,
    );
  }

  return request<T>(input.confirmPath, {
    method: "POST",
    body: JSON.stringify({ uploadId: signed.uploadId }),
  });
}
