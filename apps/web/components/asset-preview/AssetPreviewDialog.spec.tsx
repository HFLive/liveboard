import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetPreviewDialog, getAssetPreviewKind } from "./AssetPreviewDialog";

const textAsset = {
  id: "asset-1",
  filename: "list.txt",
  mimeType: "text/plain",
  sizeBytes: 282,
};

describe("AssetPreviewDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a plain-text preview and keeps the download action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("第一行\n第二行")),
    );
    render(<AssetPreviewDialog asset={textAsset} onClose={vi.fn()} />);

    expect(screen.getAllByText("list.txt")).toHaveLength(1);
    expect(await screen.findByText(/第一行/)).toBeInTheDocument();
    expect(screen.getByText(/282 B/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载" })).toBeInTheDocument();
  });

  it("uses classroom-specific preview and download paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("课堂讲义"));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AssetPreviewDialog
        asset={{
          ...textAsset,
          downloadPath: "/classrooms/classroom-1/files/file-1",
          previewPath: "/classrooms/classroom-1/files/file-1/preview",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("课堂讲义")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/classrooms/classroom-1/files/file-1/preview"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute(
      "href",
      expect.stringContaining("/classrooms/classroom-1/files/file-1"),
    );
  });

  it("uses the classroom inline endpoint for classroom images", () => {
    render(
      <AssetPreviewDialog
        asset={{
          ...textAsset,
          filename: "课堂截图.png",
          mimeType: "image/png",
          imagePath: "/classrooms/classroom-1/files/file-1?inline=1",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "课堂截图.png" })).toHaveAttribute(
      "src",
      expect.stringContaining("/classrooms/classroom-1/files/file-1?inline=1"),
    );
  });

  it("closes from the icon and Escape key", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("preview")));
    const onClose = vi.fn();
    render(<AssetPreviewDialog asset={textAsset} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭文件预览" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders Markdown without executing embedded HTML or remote images", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            "# 标题\n\n<script>alert(1)</script>\n\n![远程](https://example.com/a.png)",
          ),
        ),
    );
    render(
      <AssetPreviewDialog
        asset={{
          ...textAsset,
          filename: "notes.md",
          mimeType: "text/markdown",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "标题" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("alert(1)")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("[图片：远程]")).toBeInTheDocument();
  });

  it("keeps unsupported files download-only", () => {
    render(
      <AssetPreviewDialog
        asset={{
          ...textAsset,
          filename: "slides.pptx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("无法在线预览")).toBeInTheDocument();
    expect(screen.getByText("下载后可使用本地应用打开。")).toBeInTheDocument();
  });

  it.each([
    ["photo.png", "image/png", "image"],
    ["handout.pdf", "application/pdf", "pdf"],
    ["notes.md", "text/plain", "markdown"],
    ["list.txt", "application/octet-stream", "text"],
    ["page.html", "text/html", "unsupported"],
  ])("classifies %s as %s preview", (filename, mimeType, expected) => {
    expect(getAssetPreviewKind(filename, mimeType)).toBe(expected);
  });
});
