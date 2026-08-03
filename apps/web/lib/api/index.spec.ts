import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "./client";
import {
  AI_USAGE_CONSUMED_EVENT,
  askAiStream,
  attachmentDownloadUrl,
  uploadAssetDirect,
  configureHttpAccess,
  disableHttps,
  downloadMarkdown,
  enableHttps,
  fetchAssetPreview,
  getHttpsStatus,
  getMe,
  getPublicSettings,
  importMarkdown,
  resolveBlockAssetUrl,
  setHttpsAutoRenew,
} from "./index";

describe("Asset preview API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches preview bytes with the current session", async () => {
    const response = new Response("preview", { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAssetPreview("asset-1")).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/assets/asset-1/preview`,
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("surfaces preview validation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: "PDF 超过 25MB，请下载后查看" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(fetchAssetPreview("asset-1")).rejects.toMatchObject({
      message: "PDF 超过 25MB，请下载后查看",
      status: 400,
    });
  });
});

describe("Current user API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deduplicates concurrent current-user requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "user-1",
            username: "admin",
            displayName: "Admin",
            systemRole: "super_admin",
            status: "active",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second, third] = await Promise.all([
      getMe(),
      getMe(),
      getMe(),
    ]);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("Public settings API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deduplicates concurrent public-settings requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          settings: {
            workspaceName: "LiveBoard",
            workspaceSlug: "liveboard",
            timeZone: "Asia/Shanghai",
            faviconUrl: null,
            faviconLightUrl: null,
            faviconDarkUrl: null,
            updatedAt: "2026-08-02T00:00:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      getPublicSettings(),
      getPublicSettings(),
    ]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("Markdown API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads the selected file and folder as multipart data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          file: { id: "file-1", title: "课程" },
          warnings: [],
          blockCount: 2,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["# 标题"], "课程.md", { type: "text/markdown" });

    await expect(
      importMarkdown({ folderId: "folder-1", file }),
    ).resolves.toMatchObject({
      blockCount: 2,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${API_URL}/files/import/markdown`,
    );
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("folderId")).toBe("folder-1");
    expect((init.body as FormData).get("file")).toBe(file);
  });

  it("downloads UTF-8 Markdown and reads its encoded filename", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# 标题\n", {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition":
              "attachment; filename=content.md; filename*=UTF-8''%E7%AC%AC%E4%B8%80%E8%AE%B2.md",
          },
        }),
      ),
    );

    const result = await downloadMarkdown("file-1");

    expect(result.filename).toBe("第一讲.md");
    await expect(result.blob.text()).resolves.toBe("# 标题\n");
  });

  it("surfaces import validation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "只支持上传 .md 文件" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      importMarkdown({
        folderId: "folder-1",
        file: new File(["text"], "课程.txt"),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "只支持上传 .md 文件",
        status: 400,
      }),
    );
  });
});

describe("HTTPS settings API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and updates host HTTPS settings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            https: {
              available: true,
              enabled: false,
              domain: null,
              challengeType: null,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            https: {
              available: true,
              enabled: true,
              domain: "board.example.com",
              challengeType: "tls-alpn-01",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ https: { enabled: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ https: { enabled: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ https: { enabled: false } }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getHttpsStatus();
    await enableHttps({
      domain: "board.example.com",
      email: "admin@example.com",
    });
    await setHttpsAutoRenew(false);
    await configureHttpAccess({
      primaryHost: "8.166.143.156",
      allowedHosts: ["8.166.143.156", "board.example.com"],
    });
    await disableHttps();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${API_URL}/admin/settings/https`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${API_URL}/admin/settings/https/enable`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        domain: "board.example.com",
        email: "admin@example.com",
      }),
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `${API_URL}/admin/settings/https/auto-renew`,
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      `${API_URL}/admin/settings/https/http-access`,
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        primaryHost: "8.166.143.156",
        allowedHosts: ["8.166.143.156", "board.example.com"],
      }),
    });
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      `${API_URL}/admin/settings/https/disable`,
    );
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({}),
    });
  });
});

describe("AI streaming API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifies the app as soon as a streamed request consumes quota", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"type":"done"}\n', {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        }),
      ),
    );
    const onConsumed = vi.fn();
    window.addEventListener(AI_USAGE_CONSUMED_EVENT, onConsumed);

    await askAiStream({ message: "测试" }, { onDelta: vi.fn() });

    expect(onConsumed).toHaveBeenCalledOnce();
    window.removeEventListener(AI_USAGE_CONSUMED_EVENT, onConsumed);
  });
});

class FakeXMLHttpRequest extends EventTarget {
  static instances: FakeXMLHttpRequest[] = [];
  readonly upload = new EventTarget();
  responseText = "";
  status = 0;
  withCredentials = false;
  method = "";
  url = "";

  constructor() {
    super();
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(_name: string, _value: string) {}

  send(_body: unknown) {}

  abort() {
    this.dispatchEvent(new Event("abort"));
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Direct asset upload API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeXMLHttpRequest.instances = [];
  });

  it("runs the sign → policy POST → confirm flow", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          uploadId: "u1",
          instruction: {
            transport: "form_post",
            url: "https://oss.example/upload",
            fields: { key: "workspace/notes.txt", policy: "signed-policy" },
            expiresAt: "2026-07-29T00:10:00.000Z",
          },
          expiresAt: "2026-07-29T00:10:00.000Z",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ asset: { id: "asset-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const promise = uploadAssetDirect({
      file: new File(["hello"], "notes.txt", { type: "text/plain" }),
      folderId: "folder-1",
    });
    await vi.waitFor(() => {
      expect(FakeXMLHttpRequest.instances.length).toBe(1);
    });
    const xhr = FakeXMLHttpRequest.instances[0]!;
    xhr.status = 200;
    xhr.dispatchEvent(new Event("load"));

    await expect(promise).resolves.toEqual({ asset: { id: "asset-1" } });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${API_URL}/assets/upload-url`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          filename: "notes.txt",
          sizeBytes: 5,
          mimeType: "text/plain",
          fileId: undefined,
          folderId: "folder-1",
        }),
      }),
    );
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("https://oss.example/upload");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${API_URL}/assets/upload-confirm`,
      expect.objectContaining({ body: JSON.stringify({ uploadId: "u1" }) }),
    );
  });

  it("uploads large files in concurrent storage-backed parts with continuous progress", async () => {
    const partSizeBytes = 8 * 1024 * 1024;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          uploadId: "u-large",
          instruction: {
            transport: "multipart",
            mode: "direct",
            partSizeBytes,
            partCount: 2,
            expiresAt: "2026-07-29T00:10:00.000Z",
          },
          expiresAt: "2026-07-29T00:10:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          url: "https://oss.example/part-1",
          headers: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          url: "https://oss.example/part-2",
          headers: {},
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ asset: { id: "asset-large" } }));
    const onProgress = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const file = new File([new Uint8Array(partSizeBytes + 1)], "large.bin", {
      type: "application/octet-stream",
    });
    const promise = uploadAssetDirect(
      { file, folderId: "folder-1" },
      { onProgress },
    );

    await vi.waitFor(() => {
      expect(FakeXMLHttpRequest.instances.length).toBe(2);
    });
    const firstPart = FakeXMLHttpRequest.instances[0]!;
    const secondPart = FakeXMLHttpRequest.instances[1]!;
    firstPart.upload.dispatchEvent(
      Object.assign(new Event("progress"), {
        lengthComputable: true,
        loaded: partSizeBytes / 2,
        total: partSizeBytes,
      }),
    );
    firstPart.status = 200;
    firstPart.dispatchEvent(new Event("load"));
    secondPart.status = 200;
    secondPart.dispatchEvent(new Event("load"));

    await expect(promise).resolves.toEqual({
      asset: { id: "asset-large" },
    });
    expect(firstPart.url).toBe("https://oss.example/part-1");
    expect(secondPart.url).toBe("https://oss.example/part-2");
    expect(onProgress).toHaveBeenLastCalledWith(100);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${API_URL}/assets/upload-confirm`,
      expect.objectContaining({
        body: JSON.stringify({ uploadId: "u-large" }),
      }),
    );
  });

  it("falls back to the relay upload when direct upload is unsupported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ message: "当前存储配置不支持签名直入" }, 501),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const promise = uploadAssetDirect({
      file: new File(["hello"], "notes.txt", { type: "text/plain" }),
      folderId: "folder-1",
    });
    await vi.waitFor(() => {
      expect(FakeXMLHttpRequest.instances.length).toBe(1);
    });
    const xhr = FakeXMLHttpRequest.instances[0]!;
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ asset: { id: "asset-2" } });
    xhr.dispatchEvent(new Event("load"));

    await expect(promise).resolves.toEqual({ asset: { id: "asset-2" } });
    // 回退中转:XHR 直接 POST 表单到 /assets/upload
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(`${API_URL}/assets/upload`);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts the reservation and falls back when the direct POST fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          uploadId: "u1",
          instruction: {
            transport: "form_post",
            url: "https://oss.example/upload",
            fields: { key: "workspace/notes.txt", policy: "signed-policy" },
            expiresAt: "2026-07-29T00:10:00.000Z",
          },
          expiresAt: "2026-07-29T00:10:00.000Z",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const promise = uploadAssetDirect({
      file: new File(["hello"], "notes.txt", { type: "text/plain" }),
      folderId: "folder-1",
    });
    // 第一个 XHR 是 OSS Policy 表单直传,模拟 CORS/网络失败
    await vi.waitFor(() => {
      expect(FakeXMLHttpRequest.instances.length).toBe(1);
    });
    const directXhr = FakeXMLHttpRequest.instances[0]!;
    directXhr.dispatchEvent(new Event("error"));
    // 回退后第二个 XHR 是中转 POST
    await vi.waitFor(() => {
      expect(FakeXMLHttpRequest.instances.length).toBe(2);
    });
    const relayXhr = FakeXMLHttpRequest.instances[1]!;
    relayXhr.status = 200;
    relayXhr.responseText = JSON.stringify({ asset: { id: "asset-3" } });
    relayXhr.dispatchEvent(new Event("load"));

    await expect(promise).resolves.toEqual({ asset: { id: "asset-3" } });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${API_URL}/assets/upload-abort`,
      expect.objectContaining({ body: JSON.stringify({ uploadId: "u1" }) }),
    );
    expect(relayXhr.method).toBe("POST");
    expect(relayXhr.url).toBe(`${API_URL}/assets/upload`);
  });

  it("propagates validation errors from signing without a relay retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ message: "文档附件容量不足" }, 400),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    await expect(
      uploadAssetDirect({
        file: new File(["hello"], "notes.txt", { type: "text/plain" }),
        folderId: "folder-1",
      }),
    ).rejects.toMatchObject({ message: "文档附件容量不足", status: 400 });
    expect(FakeXMLHttpRequest.instances).toHaveLength(0);
  });
});

describe("Block asset URL resolution", () => {
  it("resolves relative asset paths to the current API base", () => {
    expect(resolveBlockAssetUrl("/assets/asset-1")).toBe(
      `${API_URL}/assets/asset-1`,
    );
  });

  it("rewrites legacy absolute asset URLs to the current API base", () => {
    expect(
      resolveBlockAssetUrl("http://localhost:4000/assets/asset-1"),
    ).toBe(`${API_URL}/assets/asset-1`);
    expect(
      resolveBlockAssetUrl("https://old.example.com/assets/asset-2"),
    ).toBe(`${API_URL}/assets/asset-2`);
  });

  it("leaves external and non-asset URLs untouched", () => {
    expect(resolveBlockAssetUrl("https://example.com/image.png")).toBe(
      "https://example.com/image.png",
    );
    expect(resolveBlockAssetUrl("/other/path.png")).toBe("/other/path.png");
  });

  it("forces download for asset attachment URLs regardless of stored host", () => {
    expect(attachmentDownloadUrl("/assets/asset-1")).toBe(
      `${API_URL}/assets/asset-1?download=1`,
    );
    expect(
      attachmentDownloadUrl("http://localhost:4000/assets/asset-1"),
    ).toBe(`${API_URL}/assets/asset-1?download=1`);
  });

  it("returns non-asset attachment URLs unchanged", () => {
    expect(attachmentDownloadUrl("https://example.com/file.pdf")).toBe(
      "https://example.com/file.pdf",
    );
  });
});
