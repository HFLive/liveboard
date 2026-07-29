import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "./client";
import {
  AI_USAGE_CONSUMED_EVENT,
  askAiStream,
  uploadAssetDirect,
  configureHttpAccess,
  disableHttps,
  downloadMarkdown,
  enableHttps,
  getHttpsStatus,
  getMe,
  importMarkdown,
  setHttpsAutoRenew,
} from "./index";

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

  it("runs the sign → PUT → confirm flow", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ uploadId: "u1", url: "https://oss.example/put" }),
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
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("https://oss.example/put");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${API_URL}/assets/upload-confirm`,
      expect.objectContaining({ body: JSON.stringify({ uploadId: "u1" }) }),
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

  it("aborts the reservation and falls back when the direct PUT fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ uploadId: "u1", url: "https://oss.example/put" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const promise = uploadAssetDirect({
      file: new File(["hello"], "notes.txt", { type: "text/plain" }),
      folderId: "folder-1",
    });
    // 第一个 XHR 是直传 PUT,模拟 CORS/网络失败
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
