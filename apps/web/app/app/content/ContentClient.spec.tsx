import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
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

function getTree() {
  const tree = document.querySelector(".file-tree");
  expect(tree).not.toBeNull();
  return tree as HTMLElement;
}

async function enterFolderFromTree(name: string) {
  fireEvent.click(await within(getTree()).findByRole("button", { name }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "返回上一级" }),
    ).toBeInTheDocument(),
  );
}

describe("ContentClient folder deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(getFolderTree)
      .mockResolvedValueOnce({ folders: folderTree, canManagePins: false })
      .mockResolvedValue({ folders: [], canManagePins: false });
    vi.mocked(deleteFolder).mockResolvedValue({ ok: true });
  });

  it("shows only folders in the location tree and collapses them", async () => {
    render(<ContentClient />);

    const tree = document.querySelector(".file-tree");
    expect(tree).not.toBeNull();
    await within(tree as HTMLElement).findByTitle("课程资料");
    // 位置树只展示文件夹，文档统一在右侧表格呈现
    expect(
      within(tree as HTMLElement).queryByRole("link", { name: "课程导读" }),
    ).not.toBeInTheDocument();
    expect(
      within(tree as HTMLElement).getByRole("button", { name: "第一章" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(tree as HTMLElement).getByRole("button", {
        name: "折叠“课程资料”",
      }),
    );

    expect(
      within(tree as HTMLElement).queryByRole("button", { name: "第一章" }),
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

    await enterFolderFromTree("课程资料");
    const moveDown = await screen.findByRole("button", {
      name: "下移“第一章”",
    });
    const leftTree = getTree();
    expect(leftTree?.querySelector(".content-pinned-panel")).toBeNull();
    expect(document.querySelector(".content-pinned-panel")).toBeNull();
    const table = screen.getByRole("table");
    const tableRows = within(table).getAllByRole("row");
    expect(tableRows[0]).toHaveClass("content-pinned-row");
    expect(tableRows[0]).toHaveTextContent("第一章");
    expect(tableRows[1]).toHaveClass("content-pinned-row");
    expect(tableRows[1]).toHaveTextContent("课程导读");
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

    await enterFolderFromTree("课程资料");
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

    await enterFolderFromTree("课程资料");
    const table = screen.getByRole("table");
    const documentLink = await within(table).findByRole("link", {
      name: "课程导读",
    });
    expect(documentLink).toHaveClass("content-file-link");
    expect(documentLink).toHaveAttribute("target", "_blank");
    expect(documentLink).toHaveAttribute("rel", "noopener noreferrer");
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

  it("opens a row menu from its SVG icon without opening the document", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.mocked(listFiles).mockResolvedValueOnce({
      files: folderTree[0]!.files,
    });

    render(<ContentClient />);

    await enterFolderFromTree("课程资料");
    const menuButton = within(screen.getByRole("table")).getByRole("button", {
      name: "“课程导读”文档操作",
    });
    const menuIcon = menuButton.querySelector("svg");
    expect(menuIcon).not.toBeNull();

    fireEvent.click(menuIcon as SVGElement);

    expect(openSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".content-row-context-menu")).not.toBeNull();
    openSpy.mockRestore();
  });

  it("offers folder and document creation from the new menu", async () => {
    render(<ContentClient />);

    await enterFolderFromTree("课程资料");
    fireEvent.click(await screen.findByRole("button", { name: "新建" }));

    expect(
      screen.getByRole("menuitem", { name: "新建文件夹" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "创建文档" }));
    expect(
      screen.getByRole("heading", { name: "创建文档" }),
    ).toBeInTheDocument();
    expect(screen.getByText("文档名称")).toBeInTheDocument();
    expect(screen.queryByText("文档类型")).not.toBeInTheDocument();
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

    await enterFolderFromTree("课程资料");
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
      await within(table).findByRole("button", { name: "课程资料" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("排序")).toHaveValue("updated");
    fireEvent.click(
      within(table).getByRole("button", { name: "“课程资料”文件夹操作" }),
    );
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

  it("goes up one level from the back button", async () => {
    render(<ContentClient />);

    const table = screen.getByRole("table");
    expect(
      await within(table).findByRole("button", { name: "课程资料" }),
    ).toBeInTheDocument();
    // 顶层时返回按钮隐藏占位且不可点击，保持路径文字位置一致
    const backAtRoot = screen.getByRole("button", { name: "返回上一级" });
    expect(backAtRoot).toBeDisabled();
    expect(backAtRoot).toHaveClass("is-hidden");

    await enterFolderFromTree("课程资料");
    fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", { name: "第一章" }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).queryByRole("button", {
          name: "第一章",
        }),
      ).not.toBeInTheDocument(),
    );

    // 返回上一级回到“课程资料”，而不是直接回到顶层
    fireEvent.click(screen.getByRole("button", { name: "返回上一级" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByRole("button", {
          name: "第一章",
        }),
      ).toBeInTheDocument(),
    );

    // 顶层文件夹的上一级是顶层“/”
    fireEvent.click(screen.getByRole("button", { name: "返回上一级" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "返回上一级" })).toHaveClass(
        "is-hidden",
      ),
    );
    expect(
      within(screen.getByRole("table")).getByRole("button", {
        name: "课程资料",
      }),
    ).toBeInTheDocument();
  });

  it("restores the last opened folder when the page loads again", async () => {
    vi.mocked(getFolderTree)
      .mockReset()
      .mockResolvedValue({ folders: folderTree, canManagePins: false });

    const firstRender = render(<ContentClient />);
    await enterFolderFromTree("课程资料");
    firstRender.unmount();

    render(<ContentClient />);

    // “返回文档”回到列表页时直接落在最近打开的目录，而不是顶层
    await screen.findByRole("button", { name: "返回上一级" });
    expect(
      within(screen.getByRole("table")).getByRole("button", { name: "第一章" }),
    ).toBeInTheDocument();
  });

  it("restores the last opened folder under StrictMode double effects", async () => {
    vi.mocked(getFolderTree)
      .mockReset()
      .mockResolvedValue({ folders: folderTree, canManagePins: false });
    window.localStorage.setItem("liveboard:content-active-folder", "folder-2");

    render(
      <StrictMode>
        <ContentClient />
      </StrictMode>,
    );

    // 开发模式 StrictMode 会重复执行挂载 effect，恢复逻辑必须保持幂等
    await screen.findByRole("button", { name: "返回上一级" });
    const breadcrumb = screen.getByLabelText("当前位置");
    expect(
      within(breadcrumb).getByRole("button", { name: "课程资料" }),
    ).toBeInTheDocument();
    expect(breadcrumb).toHaveTextContent("第一章");
    expect(window.localStorage.getItem("liveboard:content-active-folder")).toBe(
      "folder-2",
    );
  });
});
