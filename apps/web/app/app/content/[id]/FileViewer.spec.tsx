import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFile, listBlocks } from "@/lib/api";
import { FileViewer } from "./FileViewer";

vi.mock("@/lib/api", () => ({
  getFile: vi.fn(),
  listBlocks: vi.fn(),
}));

describe("FileViewer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(getFile).mockResolvedValue({
      file: {
        id: "file-1",
        folderId: "folder-1",
        title: "展示文档",
        type: "doc",
        status: "published",
        pinnedOrder: null,
        updatedAt: "2026-07-15T00:00:00.000Z",
        permission: "editor",
        version: 1,
      },
    });
    vi.mocked(listBlocks).mockResolvedValue({
      blocks: [
        {
          id: "block-1",
          fileId: "file-1",
          type: "paragraph",
          sortOrder: 10,
          dataJson: { text: "默认只展示正文" },
        },
      ],
    });
  });

  it("renders a read-only document with a separate edit link", async () => {
    render(<FileViewer fileId="file-1" />);

    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "展示文档",
    });
    expect(heading).toBeInTheDocument();
    // 已发布不加标签：每篇正式文档都一样，标出来只是噪声。
    expect(
      heading
        .closest(".content-viewer-heading")
        ?.querySelector(".content-viewer-status"),
    ).toBeNull();
    expect(screen.queryByText("已发布")).not.toBeInTheDocument();
    expect(screen.getByText("默认只展示正文")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "编辑" })).toHaveAttribute(
      "href",
      "/app/content/file-1/edit",
    );
    expect(
      screen.queryByRole("link", { name: "返回文档" }),
    ).not.toBeInTheDocument();
  });

  it("still marks a draft so readers know it is not the published version", async () => {
    vi.mocked(getFile).mockResolvedValueOnce({
      file: {
        id: "file-1",
        folderId: "folder-1",
        title: "草稿文档",
        type: "doc",
        status: "draft",
        pinnedOrder: null,
        updatedAt: "2026-07-15T00:00:00.000Z",
        permission: "editor",
        version: 1,
      },
    });

    render(<FileViewer fileId="file-1" />);

    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "草稿文档",
    });
    const status = heading
      .closest(".content-viewer-heading")
      ?.querySelector(".content-viewer-status");
    expect(status).toHaveTextContent("草稿");
    expect(status?.parentElement).toHaveClass("content-viewer-kicker");
  });

  it("does not show the edit link to a viewer", async () => {
    vi.mocked(getFile).mockResolvedValueOnce({
      file: {
        id: "file-1",
        folderId: "folder-1",
        title: "只读文档",
        type: "doc",
        status: "published",
        pinnedOrder: null,
        updatedAt: "2026-07-15T00:00:00.000Z",
        permission: "viewer",
        version: 1,
      },
    });

    render(<FileViewer fileId="file-1" />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "只读文档" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "编辑" }),
    ).not.toBeInTheDocument();
  });

  it("uses serif reading typography and persists font preferences", async () => {
    render(<FileViewer fileId="file-1" />);

    await screen.findByRole("heading", { level: 1, name: "展示文档" });
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-reader-font", "serif");
    expect(article).toHaveStyle({ "--reader-font-size": "19px" });

    fireEvent.click(screen.getByRole("button", { name: "楷体" }));
    fireEvent.click(screen.getByRole("button", { name: "增大正文字号" }));

    expect(article).toHaveAttribute("data-reader-font", "kai");
    expect(article).toHaveStyle({ "--reader-font-size": "20px" });
    await waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem("liveboard:reader-preferences") ?? "{}",
        ),
      ).toEqual({ font: "kai", fontSize: 20 }),
    );
  });
});
