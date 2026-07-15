import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderNode } from "@liveboard/shared";
import { ContentClient } from "./ContentClient";
import { deleteFolder, getFolderTree } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  createFile: vi.fn(),
  createFolder: vi.fn(),
  deleteFile: vi.fn(),
  deleteFolder: vi.fn(),
  deletePermissionGrant: vi.fn(),
  getFolderTree: vi.fn(),
  importMarkdown: vi.fn(),
  listAssignablePermissionGroups: vi.fn().mockResolvedValue({ groups: [] }),
  listFiles: vi.fn().mockResolvedValue({ files: [] }),
  listPermissionGrants: vi
    .fn()
    .mockResolvedValue({ grants: [], inheritedGrants: [] }),
  updateFile: vi.fn(),
  updateFolder: vi.fn(),
  upsertPermissionGrant: vi.fn(),
}));

const folderTree: FolderNode[] = [
  {
    id: "folder-1",
    name: "课程资料",
    parentId: null,
    permission: "editor",
    fileCount: 2,
    updatedAt: "2026-07-15T04:00:00.000Z",
    children: [
      {
        id: "folder-2",
        name: "第一章",
        parentId: "folder-1",
        permission: "editor",
        fileCount: 3,
        updatedAt: "2026-07-15T05:00:00.000Z",
        children: [],
      },
    ],
  },
];

describe("ContentClient folder deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFolderTree)
      .mockResolvedValueOnce({ folders: folderTree })
      .mockResolvedValue({ folders: [] });
    vi.mocked(deleteFolder).mockResolvedValue({ ok: true });
  });

  it("requires two confirmations before recursively deleting a folder", async () => {
    render(<ContentClient />);

    const folderName = await screen.findByTitle("课程资料");
    expect(
      within(screen.getByRole("table")).getByRole("button", {
        name: "第一章",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("排序")).toHaveValue("updated");
    const folderRow = folderName.closest("[data-menu-root='true']");
    expect(folderRow).not.toBeNull();
    fireEvent.click(within(folderRow as HTMLElement).getByTitle("文件夹操作"));
    fireEvent.click(screen.getByRole("button", { name: "删除文件夹" }));

    expect(screen.getByText("此操作无法撤销")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "1个子文件夹和5个文档",
    );
    expect(deleteFolder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "继续删除" }));
    const finalDelete = screen.getByRole("button", { name: "永久删除" });
    expect(finalDelete).toBeDisabled();

    fireEvent.change(screen.getByLabelText("输入文件夹名称“课程资料”以确认"), {
      target: { value: "课程资料" },
    });
    expect(finalDelete).toBeEnabled();
    fireEvent.click(finalDelete);

    await waitFor(() =>
      expect(deleteFolder).toHaveBeenCalledWith("folder-1", "课程资料"),
    );
    expect(
      await screen.findByText("文件夹及其中的内容已删除"),
    ).toBeInTheDocument();
  });
});
