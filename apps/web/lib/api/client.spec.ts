import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_URL,
  ApiError,
  postToObjectStorageWithProgress,
  request,
  shouldRedirectToLogin,
  uploadFormData,
} from "./client";

class FakeXMLHttpRequest extends EventTarget {
  static latest: FakeXMLHttpRequest | null = null;
  readonly upload = new EventTarget();
  responseText = "";
  status = 0;
  withCredentials = false;
  method = "";
  url = "";
  body: unknown = null;

  constructor() {
    super();
    FakeXMLHttpRequest.latest = this;
  }

  headers: Record<string, string> = {};

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: unknown) {
    this.body = body;
  }

  abort() {
    this.dispatchEvent(new Event("abort"));
  }
}

describe("API request client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends JSON requests with credentials and caller headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      request<{ ok: boolean }>("/health", {
        method: "POST",
        headers: { "X-Request-ID": "request-1" },
        body: JSON.stringify({ value: 1 }),
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/health`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": "request-1",
      },
      body: JSON.stringify({ value: 1 }),
    });
  });

  it("returns undefined for an empty 204 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(
      request("/resource", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });

  it("joins validation messages in an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: ["名称不能为空", "密码太短"] }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const error = await request("/resource").catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: "ApiError",
      message: "名称不能为空；密码太短",
      status: 400,
    });
  });

  it("falls back when an error response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("gateway error", { status: 502 })),
    );

    await expect(request("/resource")).rejects.toMatchObject({
      message: "Request failed",
      status: 502,
    });
  });

  it.each([
    [401, "/files", true],
    [401, "/auth/login", false],
    [403, "/files", false],
  ])(
    "decides whether authentication failures require login",
    (status, path, expected) => {
      expect(shouldRedirectToLogin(status, path)).toBe(expected);
    },
  );

  it("reports browser upload progress and resolves the JSON response", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const onProgress = vi.fn();
    const promise = uploadFormData<{ ok: boolean }>(
      "/assets/upload",
      new FormData(),
      "上传失败",
      { onProgress },
    );
    const xhr = FakeXMLHttpRequest.latest!;

    xhr.upload.dispatchEvent(
      Object.assign(new Event("progress"), {
        lengthComputable: true,
        loaded: 42,
        total: 100,
      }),
    );
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ ok: true });
    xhr.dispatchEvent(new Event("load"));

    await expect(promise).resolves.toEqual({ ok: true });
    expect(onProgress).toHaveBeenNthCalledWith(1, 42);
    expect(onProgress).toHaveBeenLastCalledWith(100);
    expect(xhr.withCredentials).toBe(true);
  });

  it("aborts the request when the upload task is cancelled", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const controller = new AbortController();
    const promise = uploadFormData(
      "/assets/upload",
      new FormData(),
      "上传失败",
      { signal: controller.signal },
    );

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("posts the signed policy fields before the file with real progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const onProgress = vi.fn();
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const promise = postToObjectStorageWithProgress(
      "https://oss.example/upload",
      { key: "workspace/notes.txt", policy: "signed-policy" },
      file,
      { onProgress },
    );
    const xhr = FakeXMLHttpRequest.latest!;

    xhr.upload.dispatchEvent(
      Object.assign(new Event("progress"), {
        lengthComputable: true,
        loaded: 4,
        total: 5,
      }),
    );
    xhr.status = 200;
    xhr.dispatchEvent(new Event("load"));

    await expect(promise).resolves.toBeUndefined();
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("https://oss.example/upload");
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.body).toBeInstanceOf(FormData);
    const entries = [...(xhr.body as FormData).entries()];
    expect(entries.slice(0, -1)).toEqual([
      ["key", "workspace/notes.txt"],
      ["policy", "signed-policy"],
    ]);
    expect(entries.at(-1)?.[0]).toBe("file");
    expect(entries.at(-1)?.[1]).toBe(file);
    expect(onProgress).toHaveBeenNthCalledWith(1, 80);
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it("direct object storage upload rejects on a non-2xx response", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const promise = postToObjectStorageWithProgress(
      "https://oss.example/upload",
      { policy: "signed-policy" },
      new File(["hello"], "notes.txt", { type: "text/plain" }),
    );
    const xhr = FakeXMLHttpRequest.latest!;

    xhr.status = 403;
    xhr.dispatchEvent(new Event("load"));

    await expect(promise).rejects.toThrow("直传对象存储失败(403)");
  });

  it("direct object storage upload rejects with AbortError when cancelled", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const controller = new AbortController();
    const promise = postToObjectStorageWithProgress(
      "https://oss.example/upload",
      { policy: "signed-policy" },
      new File(["hello"], "notes.txt", { type: "text/plain" }),
      { signal: controller.signal },
    );

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
