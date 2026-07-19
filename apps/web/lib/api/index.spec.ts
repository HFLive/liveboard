import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "./client";
import {
  AI_USAGE_CONSUMED_EVENT,
  askAiStream,
  downloadMarkdown,
  importMarkdown,
} from "./index";

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
