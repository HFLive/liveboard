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
import { UserPreferencesProvider } from "@/components/app-shell/UserPreferencesProvider";
import {
  deleteFolder,
  deleteLibraryAsset,
  getFolderTree,
  getMe,
  listFiles,
  uploadAsset,
  updateContentPins,
} from "@/lib/api";

function makeUser(openContentInCurrentTab = false) {
  return {
    id: "user-1",
    username: "admin",
    displayName: "管理员",
    avatarUrl: null,
    bannerUrl: null,
    bio: null,
    systemRole: "member" as const,
    status: "active" as const,
    openContentInCurrentTab,
  };
}

const routerState = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerState,
}));

vi.mock("@/lib/api", () => ({
  apiResourceUrl: vi.fn((path: string) => path),
  assetDownloadUrl: vi.fn((assetId: string) => `/assets/${assetId}?download=1`),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  deleteFile: vi.fn(),
  deleteFolder: vi.fn(),
  deleteLibraryAsset: vi.fn().mockResolvedValue({ ok: true }),
  deletePermissionGrant: vi.fn(),
  getFolderTree: vi.fn(),
  getMe: vi.fn().mockResolvedValue({
    user: {
      id: "user-1",
      username: "admin",
      displayName: "管理员",
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
      systemRole: "member",
      status: "active",
      openContentInCurrentTab: false,
    },
  }),
  importMarkdown: vi.fn(),
  listAssignablePermissionUsers: vi
    .fn()
    .mockResolvedValue({ users: [], tags: [] }),
  listFiles: vi.fn().mockResolvedValue({ files: [], standaloneAssets: [] }),
  listPermissionGrants: vi
    .fn()
    .mockResolvedValue({ grants: [], inheritedGrants: [] }),
  renameAsset: vi.fn(),
  updateFile: vi.fn(),
  updateFolder: vi.fn(),
  updateContentPins: vi.fn(),
  uploadAsset: vi.fn(),
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
    expect(screen.getByLabelText("当前位置")).toHaveTextContent(name),
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
    expect((tree as HTMLElement).querySelector(".tree-count")).toBeNull();

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

  it("renders standalone files with download and delete actions", async () => {
    vi.mocked(listFiles).mockResolvedValue({
      files: [],
      standaloneAssets: [
        {
          id: "asset-1",
          folderId: "folder-1",
          filename: "讲义.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          canManage: true,
          updatedAt: "2026-07-20T08:00:00.000Z",
        },
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ContentClient />);
    await enterFolderFromTree("课程资料");

    const downloadLinks = await screen.findAllByRole("link", {
      name: /讲义\.pdf/,
    });
    expect(downloadLinks[0]).toHaveAttribute("href", "/assets/asset-1");

    fireEvent.click(screen.getByTitle("文件操作"));
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(deleteLibraryAsset).toHaveBeenCalledWith("asset-1"),
    );
  });

  it("rejects invalid and duplicate upload names before sending the file", async () => {
    vi.mocked(listFiles).mockResolvedValue({
      files: [],
      standaloneAssets: [
        {
          id: "asset-1",
          folderId: "folder-1",
          filename: "讲义.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          canManage: true,
          updatedAt: "2026-07-20T08:00:00.000Z",
        },
      ],
    });

    render(<ContentClient />);
    await enterFolderFromTree("课程资料");

    const input = screen.getByLabelText("上传文件到当前文件夹");
    fireEvent.change(input, {
      target: {
        files: [
          new File(["invalid"], "讲义\u200b.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    expect(
      await screen.findByText("文件名称不能包含换行、控制字符或不可见字符"),
    ).toBeInTheDocument();

    fireEvent.change(input, {
      target: {
        files: [
          new File(["duplicate"], "讲义.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    expect(
      await screen.findByText("当前文件夹中已存在同名文件"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭“讲义.pdf”" }));
    expect(
      screen.queryByText("当前文件夹中已存在同名文件"),
    ).not.toBeInTheDocument();

    fireEvent.change(input, {
      target: {
        files: [
          new File(["duplicate-again"], "讲义.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    expect(
      await screen.findByText("当前文件夹中已存在同名文件"),
    ).toBeInTheDocument();
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it("uses the system document picker for folder uploads", async () => {
    render(<ContentClient />);
    await enterFolderFromTree("课程资料");

    const input = screen.getByLabelText("上传文件到当前文件夹");
    expect(input).toHaveAttribute("type", "file");
    expect(input).not.toHaveAttribute("accept");
    expect(input).not.toHaveAttribute("capture");
  });

  it("previews uploaded files in-app and downloads via attachment URL", async () => {
    vi.mocked(listFiles).mockResolvedValue({
      files: [],
      standaloneAssets: [
        {
          id: "asset-1",
          folderId: "folder-1",
          filename: "截图.png",
          mimeType: "image/png",
          sizeBytes: 2048,
          canManage: true,
          updatedAt: "2026-07-20T08:00:00.000Z",
        },
      ],
    });

    render(<ContentClient />);
    await enterFolderFromTree("课程资料");

    fireEvent.click(await screen.findByRole("link", { name: /截图\.png/ }));

    const dialog = await screen.findByRole("dialog", { name: "截图.png" });
    expect(
      within(dialog).getByRole("img", { name: "截图.png" }),
    ).toHaveAttribute("src", "/assets/asset-1");
    expect(within(dialog).getByRole("link", { name: "下载" })).toHaveAttribute(
      "href",
      "/assets/asset-1?download=1",
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: /截图\.png/ }));
    expect(
      await screen.findByRole("dialog", { name: "截图.png" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });

    fireEvent.click(screen.getByTitle("文件操作"));
    expect(await screen.findByRole("link", { name: "下载" })).toHaveAttribute(
      "href",
      "/assets/asset-1?download=1",
    );
  });

  it("opens member-level permissions from the folder menu", async () => {
    vi.mocked(getFolderTree).mockReset().mockResolvedValue({
      folders: folderTree,
      canManagePins: true,
    });

    render(<ContentClient />);

    fireEvent.click(
      await within(getTree()).findByRole("button", {
        name: "“课程资料”文件夹操作",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "权限" }));

    expect(
      await screen.findByRole("heading", { name: "文件夹权限" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "搜索成员" }),
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
    vi.mocked(listFiles).mockResolvedValueOnce({
      files: [rootFile],
      standaloneAssets: [],
    });
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
    const contentRows = within(table)
      .getAllByRole("row")
      .filter((row) => !row.querySelector("th"));
    expect(contentRows[0]).toHaveClass("content-pinned-row");
    expect(contentRows[0]).toHaveTextContent("第一章");
    expect(contentRows[1]).toHaveClass("content-pinned-row");
    expect(contentRows[1]).toHaveTextContent("课程导读");
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
    expect(
      screen.getByRole("heading", { name: "重命名文档" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("文档名称")).toHaveValue("课程导读");
    expect(table.querySelector(".content-inline-row")).toBeNull();
    fireEvent.click(moveDown);

    await waitFor(() =>
      expect(updateContentPins).toHaveBeenCalledWith("folder-1", [
        { targetType: "file", targetId: "file-1" },
        { targetType: "folder", targetId: "folder-2" },
      ]),
    );
  });

  it("opens folder rename and move workflows in focused dialogs", async () => {
    render(<ContentClient />);

    const tree = getTree();
    const menuButton = await within(tree).findByRole("button", {
      name: "“课程资料”文件夹操作",
    });
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));

    expect(
      screen.getByRole("heading", { name: "重命名文件夹" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("文件夹名称")).toHaveValue("课程资料");
    expect(document.querySelector(".tree-inline-form")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "关闭重命名文件夹" }));
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole("button", { name: "移动到…" }));

    expect(
      screen.getByRole("heading", { name: "移动“课程资料”" }),
    ).toBeInTheDocument();
    expect(screen.getByText("选择目标位置")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "顶层" })).toBeChecked();
    expect(screen.getByRole("button", { name: "移动到这里" })).toBeDisabled();
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

  it("orders the location tree by pin, matching the table", async () => {
    const rootFolder = folderTree[0]!;
    const childFolder = rootFolder.children[0]!;
    const secondChild: FolderNode = {
      ...childFolder,
      id: "folder-3",
      name: "第二章",
      pinnedOrder: 0,
    };
    // 接口按 sortOrder → name 返回「第一章、第二章」，其中第二章被置顶。
    // 置顶是这个位置下的排列方式，左侧位置树必须和右侧表格给出同一个顺序。
    const pinnedTree: FolderNode[] = [
      {
        ...rootFolder,
        files: [],
        children: [{ ...childFolder, pinnedOrder: null }, secondChild],
      },
    ];
    vi.mocked(getFolderTree).mockReset().mockResolvedValue({
      folders: pinnedTree,
      canManagePins: true,
    });

    render(<ContentClient />);

    const tree = getTree();
    await within(tree).findByRole("button", { name: "第二章" });
    const treeNames = Array.from(
      tree.querySelectorAll(".tree-item .tree-label span[title]"),
    ).map((node) => node.textContent);
    expect(treeNames).toEqual(["课程资料", "第二章", "第一章"]);

    await enterFolderFromTree("课程资料");
    const contentRows = within(screen.getByRole("table"))
      .getAllByRole("row")
      .filter((row) => !row.querySelector("th"));
    expect(contentRows[0]).toHaveTextContent("第二章");
    expect(contentRows[1]).toHaveTextContent("第一章");
  });

  it("shows an icon before document names in the document table", async () => {
    vi.mocked(listFiles).mockResolvedValueOnce({
      files: [{ ...folderTree[0]!.files[0]!, status: "draft" }],
      standaloneAssets: [],
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

  it("switches the current directory between list and grid views and filters it locally", async () => {
    render(<ContentClient />);

    await enterFolderFromTree("课程资料");
    expect(screen.getByRole("table")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "网格视图" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const grid = document.querySelector(".content-drive-grid");
    expect(grid).not.toBeNull();
    expect(
      within(grid as HTMLElement).getByRole("button", { name: "第一章" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索当前目录" }), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("没有匹配的项目")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(
      within(grid as HTMLElement).getByRole("button", { name: "第一章" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("opens a row menu from its SVG icon without opening the document", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.mocked(listFiles).mockResolvedValueOnce({
      files: folderTree[0]!.files,
      standaloneAssets: [],
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
    const createButton = await screen.findByRole("button", { name: "新建" });
    fireEvent.click(createButton);

    expect(createButton).toHaveAttribute("aria-expanded", "true");
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

  it("uses the path itself to move up through folders", async () => {
    render(<ContentClient />);

    const table = screen.getByRole("table");
    expect(
      await within(table).findByRole("button", { name: "课程资料" }),
    ).toBeInTheDocument();
    // 顶层没有无效的“返回”占位，目录导航只在可执行时出现。
    expect(
      screen.queryByRole("button", { name: "返回上一级" }),
    ).not.toBeInTheDocument();

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

    // 通过地址栏中的父级回到“课程资料”，而不是直接回到顶层。
    const breadcrumb = screen.getByLabelText("当前位置");
    fireEvent.click(
      within(breadcrumb).getByRole("button", { name: "课程资料" }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getByRole("button", {
          name: "第一章",
        }),
      ).toBeInTheDocument(),
    );

    // 通过根目录地址回到文档根目录，根目录不显示无效返回动作。
    fireEvent.click(within(breadcrumb).getByRole("button", { name: "文档" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "返回上一级" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("table")).getByRole("button", {
        name: "课程资料",
      }),
    ).toBeInTheDocument();
  });

  it("collapses deep parent paths into an expandable breadcrumb menu", async () => {
    const rootFolder = folderTree[0]!;
    const firstChapter = rootFolder.children[0]!;
    const deepFolder: FolderNode = {
      id: "folder-3",
      name: "日程常规与线路基础",
      parentId: firstChapter.id,
      permission: "editor",
      fileCount: 0,
      pinnedOrder: null,
      updatedAt: "2026-07-15T06:00:00.000Z",
      files: [],
      children: [],
    };
    const deepTree: FolderNode[] = [
      {
        ...rootFolder,
        children: [{ ...firstChapter, children: [deepFolder] }],
      },
    ];
    vi.mocked(getFolderTree).mockReset().mockResolvedValue({
      folders: deepTree,
      canManagePins: false,
    });

    render(<ContentClient />);

    await enterFolderFromTree("课程资料");
    await enterFolderFromTree("第一章");
    await enterFolderFromTree("日程常规与线路基础");

    const breadcrumb = screen.getByLabelText("当前位置");
    expect(
      within(breadcrumb).queryByRole("button", { name: "课程资料" }),
    ).not.toBeInTheDocument();
    expect(
      within(breadcrumb).queryByRole("button", { name: "第一章" }),
    ).not.toBeInTheDocument();

    const expandPathButton = within(breadcrumb).getByRole("button", {
      name: "展开上级路径",
    });
    expect(expandPathButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expandPathButton);

    const pathMenu = screen.getByRole("menu");
    expect(
      within(pathMenu).getByRole("menuitem", { name: "课程资料" }),
    ).toBeInTheDocument();
    expect(
      within(pathMenu).getByRole("menuitem", { name: "第一章" }),
    ).toBeInTheDocument();

    fireEvent.click(within(pathMenu).getByRole("menuitem", { name: "第一章" }));
    await waitFor(() =>
      expect(screen.getByLabelText("当前位置")).toHaveTextContent("第一章"),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clears standalone files when returning to the top level", async () => {
    vi.mocked(listFiles).mockResolvedValue({
      files: [],
      standaloneAssets: [
        {
          id: "asset-1",
          folderId: "folder-1",
          filename: "测试文件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          canManage: true,
          updatedAt: "2026-07-20T08:00:00.000Z",
        },
      ],
    });

    render(<ContentClient />);
    await enterFolderFromTree("课程资料");
    expect(
      await screen.findByRole("link", { name: /测试文件\.pdf/ }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByLabelText("当前位置")).getByRole("button", {
        name: "文档",
      }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "返回上一级" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("link", { name: /测试文件\.pdf/ }),
    ).not.toBeInTheDocument();
  });

  it("restores the last opened folder when the page loads again", async () => {
    vi.mocked(getFolderTree)
      .mockReset()
      .mockResolvedValue({ folders: folderTree, canManagePins: false });

    const firstRender = render(<ContentClient />);
    await enterFolderFromTree("课程资料");
    firstRender.unmount();

    render(<ContentClient />);

    // “返回文档”回到列表页时直接落在最近打开的目录，而不是顶层。
    await waitFor(() =>
      expect(screen.getByLabelText("当前位置")).toHaveTextContent("课程资料"),
    );
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

    // 开发模式 StrictMode 会重复执行挂载 effect，恢复逻辑必须保持幂等。
    await waitFor(() =>
      expect(screen.getByLabelText("当前位置")).toHaveTextContent("第一章"),
    );
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

describe("ContentClient 文档打开偏好", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    routerState.push.mockClear();
    vi.mocked(getFolderTree)
      .mockResolvedValueOnce({ folders: folderTree, canManagePins: false })
      .mockResolvedValue({ folders: [], canManagePins: false });
    vi.mocked(getMe).mockResolvedValue({ user: makeUser(false) });
    vi.mocked(listFiles).mockResolvedValue({ files: [], standaloneAssets: [] });
  });

  it("默认（新标签页）时，文档链接带 target=_blank", async () => {
    vi.mocked(listFiles).mockResolvedValueOnce({
      files: [folderTree[0]!.files[0]!],
      standaloneAssets: [],
    });

    render(
      <UserPreferencesProvider>
        <ContentClient />
      </UserPreferencesProvider>,
    );

    await enterFolderFromTree("课程资料");
    const table = screen.getByRole("table");
    const documentLink = await within(table).findByRole("link", {
      name: "课程导读",
    });
    expect(documentLink).toHaveAttribute("target", "_blank");
  });

  it("偏好为当前标签页时，点击文档行用 router.push 在当前标签页打开", async () => {
    vi.mocked(getMe).mockResolvedValue({ user: makeUser(true) });
    vi.mocked(listFiles).mockResolvedValueOnce({
      files: [folderTree[0]!.files[0]!],
      standaloneAssets: [],
    });
    window.open = vi.fn() as unknown as typeof window.open;

    render(
      <UserPreferencesProvider>
        <ContentClient />
      </UserPreferencesProvider>,
    );

    await enterFolderFromTree("课程资料");
    fireEvent.click(screen.getByRole("row", { name: /课程导读/ }));

    await waitFor(() =>
      expect(routerState.push).toHaveBeenCalledWith("/app/content/file-1"),
    );
    expect(window.open).not.toHaveBeenCalled();
  });

  it("偏好为当前标签页时，文档链接不带 target=_blank", async () => {
    vi.mocked(getMe).mockResolvedValue({ user: makeUser(true) });
    vi.mocked(listFiles).mockResolvedValueOnce({
      files: [folderTree[0]!.files[0]!],
      standaloneAssets: [],
    });

    render(
      <UserPreferencesProvider>
        <ContentClient />
      </UserPreferencesProvider>,
    );

    await enterFolderFromTree("课程资料");
    const table = screen.getByRole("table");
    const documentLink = await within(table).findByRole("link", {
      name: "课程导读",
    });
    expect(documentLink).not.toHaveAttribute("target", "_blank");
  });
});
