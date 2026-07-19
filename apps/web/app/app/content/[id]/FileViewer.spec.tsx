import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFile, listBlocks } from "@/lib/api";
import { FileViewer } from "./FileViewer";

vi.mock("@/lib/api", () => ({
  getFile: vi.fn(),
  listBlocks: vi.fn(),
}));

describe("FileViewer", () => {
  beforeEach(() => {
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
    expect(heading.previousElementSibling).toHaveClass("content-viewer-status");
    expect(heading.previousElementSibling).toHaveTextContent("已发布");
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
});
