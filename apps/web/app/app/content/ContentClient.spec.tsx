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
import {
  deleteFolder,
  getFolderTree,
  listFiles,
  updateContentPins,
} from "@/lib/api";

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
  updateContentPins: vi.fn(),
  upsertPermissionGrant: vi.fn(),
}));

const folderTree: FolderNode[] = [
  {
    id: "folder-1",
    name: "课程资料",
    parentId: null,
    permission: "editor",
    fileCount: 2,
    pinnedOrder: null,
    updatedAt: "2026-07-15T04:00:00.000Z",
    files: [
      {
        id: "file-1",
        folderId: "folder-1",
        title: "课程导读",
        type: "doc",
        status: "published",
        pinnedOrder: null,
        updatedAt: "2026-07-15T04:30:00.000Z",
      },
    ],
    children: [
      {
        id: "folder-2",
        name: "第一章",
        parentId: "folder-1",
        permission: "editor",
        fileCount: 3,
        pinnedOrder: null,
        updatedAt: "2026-07-15T05:00:00.000Z",
        files: [],
        children: [],
      },
    ],
  },
];

describe("ContentClient folder deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFolderTree)
      .mockResolvedValueOnce({ folders: folderTree, canManagePins: false })
      .mockResolvedValue({ folders: [], canManagePins: false });
    vi.mocked(deleteFolder).mockResolvedValue({ ok: true });
  });

  it("shows files in the location tree and collapses folder contents", async () => {
    render(<ContentClient />);

    const tree = document.querySelector(".file-tree");
    expect(tree).not.toBeNull();
    await within(tree as HTMLElement).findByTitle("课程资料");
    expect(
      within(tree as HTMLElement).getByRole("link", { name: "课程导读" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(tree as HTMLElement).getByRole("button", {
        name: "折叠“课程资料”",
      }),
    );

    expect(
      within(tree as HTMLElement).queryByRole("link", { name: "课程导读" }),
    ).not.toBeInTheDocument();
    expect(
      within(tree as HTMLElement).getByRole("button", {
        name: "展开“课程资料”",
      }),
    ).toBeInTheDocument();
  });

  it("lets administrators reorder mixed pinned folders and files", async () => {
    const rootFolder = folderTree[0]!;
    const rootFile = rootFolder.files[0]!;
    const childFolder = rootFolder.children[0]!;
    const pinnedTree: FolderNode[] = [
      {
        ...rootFolder,
        pinnedOrder: null,
        files: [{ ...rootFile, pinnedOrder: 1 }],
        children: [{ ...childFolder, pinnedOrder: 0 }],
      },
    ];
    vi.mocked(getFolderTree).mockReset().mockResolvedValue({
      folders: pinnedTree,
      canManagePins: true,
    });
    vi.mocked(listFiles).mockResolvedValueOnce({ files: [rootFile] });
    vi.mocked(updateContentPins).mockResolvedValue({
      folders: pinnedTree,
      canManagePins: true,
    });

    render(<ContentClient />);

    const moveDown = await screen.findByRole("button", {
      name: "下移“第一章”",
    });
    const leftTree = document.querySelector(".file-tree");
    expect(leftTree?.querySelector(".content-pinned-panel")).toBeNull();
    expect(document.querySelector(".content-pinned-panel")).toBeNull();
    const table = screen.getByRole("table");
    const tableRows = within(table).getAllByRole("row");
    expect(tableRows[0]).toHaveTextContent("文件名最近更新");
    expect(tableRows[1]).toHaveClass("content-pinned-row");
    expect(tableRows[1]).toHaveTextContent("第一章");
    expect(tableRows[2]).toHaveClass("content-pinned-row");
    expect(tableRows[2]).toHaveTextContent("课程导读");
    expect(
      within(table).getAllByRole("link", { name: "课程导读" }),
    ).toHaveLength(1);
    fireEvent.click(
      within(table).getByRole("button", {
        name: "“课程导读”文档操作",
      }),
    );
    expect(
      screen.getByRole("button", { name: "取消置顶" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    expect(within(table).getByDisplayValue("课程导读")).toBeInTheDocument();
    fireEvent.click(moveDown);

    await waitFor(() =>
      expect(updateContentPins).toHaveBeenCalledWith("folder-1", [
        { targetType: "file", targetId: "file-1" },
        { targetType: "folder", targetId: "folder-2" },
      ]),
    );
  });

  it("shows pins only inside their own folder", async () => {
    const rootFolder = folderTree[0]!;
    const childFolder = rootFolder.children[0]!;
    const nestedFile = {
      ...rootFolder.files[0]!,
      id: "nested-file",
      folderId: childFolder.id,
      title: "第一章导读",
      pinnedOrder: 0,
    };
    const scopedTree: FolderNode[] = [
      {
        ...rootFolder,
        files: [{ ...rootFolder.files[0]!, pinnedOrder: 0 }],
        children: [
          {
            ...childFolder,
            pinnedOrder: null,
            files: [nestedFile],
          },
        ],
      },
    ];
    vi.mocked(getFolderTree).mockReset().mockResolvedValue({
      folders: scopedTree,
      canManagePins: true,
    });

    render(<ContentClient />);

    let table = screen.getByRole("table");
    expect(
      await within(table).findByRole("link", { name: "课程导读" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("link", { name: "第一章导读" }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(table).getByRole("button", { name: "第一章" }));

    await waitFor(() => {
      table = screen.getByRole("table");
      expect(
        within(table).getByRole("link", { name: "第一章导读" }),
      ).toBeInTheDocument();
      expect(
        within(table).queryByRole("link", { name: "课程导读" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows an icon before document names in the document table", async () => {
    vi.mocked(listFiles).mockResolvedValueOnce({
      files: [{ ...folderTree[0]!.files[0]!, status: "draft" }],
    });

    render(<ContentClient />);

    const table = screen.getByRole("table");
    const documentLink = await within(table).findByRole("link", {
      name: "课程导读",
    });
    expect(documentLink).toHaveClass("content-file-link");
    expect(documentLink.querySelector("svg")).not.toBeNull();
    expect(
      within(documentLink.closest("td") as HTMLElement).getByText("草稿"),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("columnheader", { name: "类型" }),
    ).toBeNull();
    expect(
      within(table).queryByRole("columnheader", { name: "状态" }),
    ).toBeNull();
    expect(
      within(table).getByRole("button", { name: "“第一章”文件夹操作" }),
    ).toHaveClass("content-row-menu-button");
    expect(
      within(table).getByRole("button", { name: "“课程导读”文档操作" }),
    ).toHaveClass("content-row-menu-button");
  });

  it("offers folder and document creation from the new menu", async () => {
    render(<ContentClient />);

    fireEvent.click(await screen.findByRole("button", { name: "新建" }));

    expect(
      screen.getByRole("menuitem", { name: "新建文件夹" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "创建文档" }));
    expect(
      screen.getByRole("heading", { name: "创建文档" }),
    ).toBeInTheDocument();
    expect(screen.getByText("文档名称")).toBeInTheDocument();
    expect(screen.getByText("文档类型")).toBeInTheDocument();
  });

  it("hides creation and Markdown import actions without write permission", async () => {
    const viewerTree: FolderNode[] = [
      {
        ...folderTree[0]!,
        permission: "viewer",
        children: folderTree[0]!.children.map((folder) => ({
          ...folder,
          permission: "viewer",
        })),
      },
    ];
    vi.mocked(getFolderTree).mockReset().mockResolvedValue({
      folders: viewerTree,
      canManagePins: false,
    });

    render(<ContentClient />);

    const tree = document.querySelector(".file-tree");
    expect(tree).not.toBeNull();
    await within(tree as HTMLElement).findByTitle("课程资料");
    expect(
      screen.queryByRole("button", { name: "导入 Markdown" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle("新建文件夹")).not.toBeInTheDocument();
  });

  it("requires two confirmations before recursively deleting a folder", async () => {
    render(<ContentClient />);

    const table = screen.getByRole("table");
    expect(
      await within(table).findByRole("button", { name: "第一章" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("排序")).toHaveValue("updated");
    fireEvent.click(
      within(table).getByRole("button", { name: "“第一章”文件夹操作" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "删除文件夹" }));

    expect(screen.getByText("此操作无法撤销")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("3个文档");
    expect(deleteFolder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "继续删除" }));
    const finalDelete = screen.getByRole("button", { name: "永久删除" });
    expect(finalDelete).toBeDisabled();

    fireEvent.change(screen.getByLabelText("输入文件夹名称“第一章”以确认"), {
      target: { value: "第一章" },
    });
    expect(finalDelete).toBeEnabled();
    fireEvent.click(finalDelete);

    await waitFor(() =>
      expect(deleteFolder).toHaveBeenCalledWith("folder-2", "第一章"),
    );
    expect(
      await screen.findByText("文件夹及其中的内容已删除"),
    ).toBeInTheDocument();
  });
});
