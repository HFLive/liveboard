"use client";

import {
  Fragment,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  X,
  FileText,
  Folder,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import type {
  ContentPinTarget,
  FileSummary,
  FolderNode,
  PermissionLevel,
  PermissionGroupSummary,
} from "@liveboard/shared";
import {
  createFile,
  createFolder,
  deleteFile,
  deleteFolder,
  deletePermissionGrant,
  getFolderTree,
  importMarkdown,
  listAssignablePermissionGroups,
  listFiles,
  listPermissionGrants,
  InheritedPermissionGrantSummary,
  PermissionGrantSummary,
  updateFile,
  updateFolder,
  updateContentPins,
  upsertPermissionGrant,
} from "@/lib/api";
import { formatDateTime, permissionLabel } from "@/lib/labels";
import { contentDetail } from "@/lib/routes";
import { SortIconSelect } from "@/components/SortIconSelect";
import { MarkdownImportButton } from "./MarkdownImportButton";

type FlatFolderNode = FolderNode & { depth: number };
type PinnedContentItem =
  | { kind: "folder"; folder: FolderNode; pinnedOrder: number }
  | { kind: "file"; file: FileSummary; pinnedOrder: number };
type ContentRowItem =
  { kind: "folder"; folder: FolderNode } | { kind: "file"; file: FileSummary };
type FloatingMenuState = {
  id: string;
  x: number;
  y: number;
};
type ContentRowMenuState = FloatingMenuState & {
  targetType: "folder" | "file";
};
type TreeDepthStyle = CSSProperties & {
  "--tree-depth": number;
};
type PermissionTarget = {
  type: "folder" | "file";
  id: string;
  name: string;
  isRoot?: boolean;
};
type DeleteFolderTarget = {
  id: string;
  name: string;
  descendantCount: number;
  fileCount: number;
};
type ContentSortMode = "name" | "updated";

const SORT_OPTIONS = [
  { value: "updated", label: "最近更新" },
  { value: "name", label: "名称" },
] as const;

// 记录最近打开的目录，供新标签页中的“返回文档”回到同一位置。
const ACTIVE_FOLDER_STORAGE_KEY = "liveboard:content-active-folder";

function persistActiveFolder(folderId: string | null) {
  if (folderId) {
    window.localStorage.setItem(ACTIVE_FOLDER_STORAGE_KEY, folderId);
  } else {
    window.localStorage.removeItem(ACTIVE_FOLDER_STORAGE_KEY);
  }
}

function canCreateFolder(level: PermissionLevel | null) {
  return level === "owner" || level === "editor";
}

function canCreateFile(level: PermissionLevel | null) {
  return canCreateFolder(level) || level === "lecturer";
}

function flattenFolders(folders: FolderNode[], depth = 0): FlatFolderNode[] {
  return folders.flatMap((folder) => [
    { ...folder, depth },
    ...flattenFolders(folder.children, depth + 1),
  ]);
}

// 左侧位置树只展示文件夹，作为纯粹的层级导航；文档统一在右侧表格呈现。
function flattenVisibleFolders(
  folders: FolderNode[],
  collapsedFolderIds: Set<string>,
  depth = 0,
): FlatFolderNode[] {
  return folders.flatMap((folder) => [
    { ...folder, depth },
    ...(collapsedFolderIds.has(folder.id)
      ? []
      : flattenVisibleFolders(folder.children, collapsedFolderIds, depth + 1)),
  ]);
}

function collectPinnedContent(
  folder: FolderNode | undefined,
): PinnedContentItem[] {
  const items: PinnedContentItem[] = [];

  if (!folder) {
    return items;
  }

  for (const childFolder of folder.children) {
    if (childFolder.pinnedOrder !== null) {
      items.push({
        kind: "folder",
        folder: childFolder,
        pinnedOrder: childFolder.pinnedOrder,
      });
    }
  }

  for (const file of folder.files) {
    if (file.pinnedOrder !== null) {
      items.push({ kind: "file", file, pinnedOrder: file.pinnedOrder });
    }
  }

  return items.sort((left, right) => left.pinnedOrder - right.pinnedOrder);
}

function pinnedTarget(item: PinnedContentItem): ContentPinTarget {
  return item.kind === "folder"
    ? { targetType: "folder", targetId: item.folder.id }
    : { targetType: "file", targetId: item.file.id };
}

function treeDepthStyle(depth: number): TreeDepthStyle {
  return { "--tree-depth": Math.min(depth, 7) };
}

export function ContentClient() {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [openContentRowMenu, setOpenContentRowMenu] =
    useState<ContentRowMenuState | null>(null);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);
  const [folderMoveTargetId, setFolderMoveTargetId] = useState("");
  const [movingFileId, setMovingFileId] = useState<string | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState("");
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [fileRename, setFileRename] = useState("");
  const [showCreateFile, setShowCreateFile] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [permissionTarget, setPermissionTarget] =
    useState<PermissionTarget | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderParentId, setFolderParentId] = useState("");
  const [folderRename, setFolderRename] = useState("");
  const [fileTitle, setFileTitle] = useState("");
  const [groups, setGroups] = useState<PermissionGroupSummary[]>([]);
  const [grants, setGrants] = useState<PermissionGrantSummary[]>([]);
  const [inheritedGrants, setInheritedGrants] = useState<
    InheritedPermissionGrantSummary[]
  >([]);
  const [canManageGrants, setCanManageGrants] = useState(false);
  const [grantGroupId, setGrantGroupId] = useState("");
  const [grantLevel, setGrantLevel] = useState<PermissionLevel>("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<DeleteFolderTarget | null>(null);
  const [deleteFolderStep, setDeleteFolderStep] = useState<1 | 2>(1);
  const [deleteFolderConfirmation, setDeleteFolderConfirmation] = useState("");
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [contentSortMode, setContentSortMode] =
    useState<ContentSortMode>("updated");
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [canManagePins, setCanManagePins] = useState(false);
  const [isUpdatingPins, setIsUpdatingPins] = useState(false);

  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);
  const visibleTreeFolders = useMemo(
    () => flattenVisibleFolders(folders, collapsedFolderIds),
    [collapsedFolderIds, folders],
  );
  const activeFolder = flatFolders.find(
    (folder) => folder.id === activeFolderId,
  );
  const isRootView = activeFolderId === null;
  // 后端允许任何登录用户创建顶层文件夹，根目录始终提供“新建文件夹”。
  const canCreateFolderHere = isRootView
    ? true
    : canCreateFolder(activeFolder?.permission ?? null);
  const canCreateFileHere = isRootView
    ? false
    : canCreateFile(activeFolder?.permission ?? null);
  const pinnedItems = useMemo(
    () => collectPinnedContent(activeFolder),
    [activeFolder],
  );
  const pinnedTargetKeys = useMemo(
    () =>
      new Set(
        pinnedItems.map((item) => {
          const target = pinnedTarget(item);
          return `${target.targetType}:${target.targetId}`;
        }),
      ),
    [pinnedItems],
  );
  const sortedChildFolders = useMemo(() => {
    const children = [
      ...(isRootView ? folders : (activeFolder?.children ?? [])),
    ];

    return children.sort((left, right) => {
      if (contentSortMode === "updated") {
        return (
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
        );
      }

      return left.name.localeCompare(right.name, "zh-CN");
    });
  }, [activeFolder?.children, contentSortMode, folders, isRootView]);
  const sortedFiles = useMemo(() => {
    const nextFiles = [...files];

    return nextFiles.sort((left, right) => {
      if (contentSortMode === "updated") {
        return (
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
        );
      }

      return left.title.localeCompare(right.title, "zh-CN");
    });
  }, [contentSortMode, files]);
  const unpinnedChildFolders = useMemo(
    () =>
      sortedChildFolders.filter(
        (folder) => !pinnedTargetKeys.has(`folder:${folder.id}`),
      ),
    [pinnedTargetKeys, sortedChildFolders],
  );
  const unpinnedFiles = useMemo(
    () =>
      sortedFiles.filter((file) => !pinnedTargetKeys.has(`file:${file.id}`)),
    [pinnedTargetKeys, sortedFiles],
  );
  const activeFolderPath = useMemo(() => {
    if (!activeFolderId) {
      return [];
    }

    const byId = new Map(flatFolders.map((folder) => [folder.id, folder]));
    const path: FlatFolderNode[] = [];
    let current = byId.get(activeFolderId);

    while (current) {
      path.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    return path;
  }, [activeFolderId, flatFolders]);
  const groupGrants = useMemo(
    () => grants.filter((grant) => grant.group),
    [grants],
  );
  const availableGrantGroups = useMemo(
    () =>
      groups.filter(
        (group) => !groupGrants.some((grant) => grant.groupId === group.id),
      ),
    [groupGrants, groups],
  );
  const inheritedFallbackByGroupId = useMemo(
    () =>
      new Map(inheritedGrants.map((grant) => [grant.groupId, grant] as const)),
    [inheritedGrants],
  );
  const visibleInheritedGrants = useMemo(
    () =>
      inheritedGrants.filter(
        (grant) =>
          !groupGrants.some((direct) => direct.groupId === grant.groupId),
      ),
    [groupGrants, inheritedGrants],
  );

  async function load() {
    const folderResult = await getFolderTree();
    const nextFlatFolders = flattenFolders(folderResult.folders);
    // activeFolderId 为 null 表示停留在顶层“/”，不自动进入任何文件夹；
    // 此时回退到 localStorage 中最近打开的目录，目录已不存在则回到顶层。
    // 注意：开发模式 StrictMode 会重复执行挂载 effect，这里必须保持幂等。
    const candidateFolderId =
      activeFolderId ?? window.localStorage.getItem(ACTIVE_FOLDER_STORAGE_KEY);
    const selectedFolderId =
      candidateFolderId &&
      nextFlatFolders.some((folder) => folder.id === candidateFolderId)
        ? candidateFolderId
        : null;

    setFolders(folderResult.folders);
    setCanManagePins(folderResult.canManagePins);
    setActiveFolderId(selectedFolderId);
    persistActiveFolder(selectedFolderId);

    if (selectedFolderId) {
      const fileResult = await listFiles(selectedFolderId);
      setFiles(fileResult.files);

      const [grantResult] = await Promise.all([
        listPermissionGrants("folder", selectedFolderId),
        loadAssignableGroups(selectedFolderId),
      ]);
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
    } else {
      setFiles([]);
      setGrants([]);
      setInheritedGrants([]);
      setGroups([]);
      setGrantGroupId("");
      setCanManageGrants(false);
    }
  }

  async function refreshTree() {
    const result = await getFolderTree();
    setFolders(result.folders);
    setCanManagePins(result.canManagePins);
  }

  async function loadAssignableGroups(folderId: string) {
    try {
      const groupResult = await listAssignablePermissionGroups({
        targetType: "folder",
        targetId: folderId,
      });
      setGroups(groupResult.groups);
      setGrantGroupId((current) => current || groupResult.groups[0]?.id || "");
      setCanManageGrants(true);
    } catch {
      setGroups([]);
      setGrantGroupId("");
      setCanManageGrants(false);
    }
  }

  async function openPermissions(target: PermissionTarget) {
    setOpenContentRowMenu(null);
    setError(null);

    try {
      const [grantResult, groupResult] = await Promise.all([
        listPermissionGrants(target.type, target.id),
        listAssignablePermissionGroups({
          targetType: target.type,
          targetId: target.id,
        }),
      ]);
      setPermissionTarget(target);
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
      setGroups(groupResult.groups);
      setGrantGroupId(groupResult.groups[0]?.id ?? "");
      setCanManageGrants(true);
      setShowPermissions(true);
    } catch (caught) {
      setCanManageGrants(false);
      setError(caught instanceof Error ? caught.message : "加载权限失败");
    }
  }

  useEffect(() => {
    load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载失败");
    });
    // The initial load should only run once; actions call load explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function closeFloatingMenus() {
      setOpenContentRowMenu(null);
      setShowCreateMenu(false);
    }

    function closeMenus(event: MouseEvent) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("[data-menu-root='true']")
      ) {
        return;
      }

      closeFloatingMenus();
    }

    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("scroll", closeFloatingMenus, true);
    window.addEventListener("resize", closeFloatingMenus);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("scroll", closeFloatingMenus, true);
      window.removeEventListener("resize", closeFloatingMenus);
    };
  }, []);

  useEffect(() => {
    if (availableGrantGroups.some((group) => group.id === grantGroupId)) {
      return;
    }

    setGrantGroupId(availableGrantGroups[0]?.id ?? "");
  }, [availableGrantGroups, grantGroupId]);

  function toggleFolderCollapsed(folderId: string) {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);

      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }

      return next;
    });
  }

  async function savePinnedTargets(
    items: ContentPinTarget[],
    successMessage: string,
  ) {
    if (!activeFolderId) {
      setError("请先选择要管理置顶内容的文件夹");
      return;
    }

    setError(null);
    setMessage(null);
    setIsUpdatingPins(true);

    try {
      const result = await updateContentPins(activeFolderId, items);
      setFolders(result.folders);
      const updatedActiveFolder = flattenFolders(result.folders).find(
        (folder) => folder.id === activeFolderId,
      );
      if (updatedActiveFolder) {
        setFiles(updatedActiveFolder.files);
      }
      setCanManagePins(result.canManagePins);
      setOpenContentRowMenu(null);
      setMessage(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新置顶失败");
    } finally {
      setIsUpdatingPins(false);
    }
  }

  async function togglePinnedTarget(target: ContentPinTarget, label: string) {
    const currentTargets = pinnedItems.map(pinnedTarget);
    const targetIndex = currentTargets.findIndex(
      (item) =>
        item.targetType === target.targetType &&
        item.targetId === target.targetId,
    );
    const nextTargets =
      targetIndex === -1
        ? [...currentTargets, target]
        : currentTargets.filter((_, index) => index !== targetIndex);

    await savePinnedTargets(
      nextTargets,
      targetIndex === -1 ? `“${label}”已置顶` : `“${label}”已取消置顶`,
    );
  }

  async function movePinnedItem(index: number, offset: -1 | 1) {
    const nextIndex = index + offset;

    if (nextIndex < 0 || nextIndex >= pinnedItems.length) {
      return;
    }

    const nextItems = [...pinnedItems];
    const currentItem = nextItems[index]!;
    nextItems[index] = nextItems[nextIndex]!;
    nextItems[nextIndex] = currentItem;
    await savePinnedTargets(nextItems.map(pinnedTarget), "置顶顺序已更新");
  }

  async function selectFolder(folderId: string) {
    setActiveFolderId(folderId);
    persistActiveFolder(folderId);
    setShowCreateMenu(false);
    setError(null);
    const [fileResult, grantResult] = await Promise.all([
      listFiles(folderId),
      listPermissionGrants("folder", folderId),
      loadAssignableGroups(folderId),
    ]);
    setFiles(fileResult.files);
    setGrants(grantResult.grants);
    setInheritedGrants(grantResult.inheritedGrants);
  }

  function selectRoot() {
    setActiveFolderId(null);
    persistActiveFolder(null);
    setFiles([]);
    setGrants([]);
    setInheritedGrants([]);
    setGroups([]);
    setCanManageGrants(false);
    setShowCreateMenu(false);
    setOpenContentRowMenu(null);
    setError(null);
  }

  function goToParentFolder() {
    if (activeFolder?.parentId) {
      void selectFolder(activeFolder.parentId);
    } else {
      selectRoot();
    }
  }

  async function onCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await createFolder({
        name: folderName,
        parentId: folderParentId || undefined,
      });
      setFolderName("");
      setFolderParentId("");
      setShowCreateFolder(false);
      setMessage("文件夹已创建");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建文件夹失败");
    }
  }

  async function onCreateFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!activeFolderId) {
      setError("请先选择文件夹");
      return;
    }

    try {
      await createFile({
        folderId: activeFolderId,
        title: fileTitle,
      });
      setFileTitle("");
      setShowCreateFile(false);
      setMessage("文档已创建");
      await selectFolder(activeFolderId);
      await refreshTree();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建文档失败");
    }
  }

  async function onImportMarkdown(file: File) {
    setError(null);
    setMessage(null);

    if (!activeFolderId) {
      setError("请先选择文件夹");
      return;
    }

    try {
      const result = await importMarkdown({ folderId: activeFolderId, file });
      const warningText = result.warnings.length
        ? `；注意：${result.warnings.join("；")}`
        : "";
      setMessage(
        `“${result.file.title}”已导入，共 ${result.blockCount} 个内容块${warningText}`,
      );
      await selectFolder(activeFolderId);
      await refreshTree();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入 Markdown 失败");
    }
  }

  async function onDeleteFile(file: FileSummary) {
    setError(null);
    setMessage(null);

    if (!window.confirm(`永久删除“${file.title}”？此操作无法撤销。`)) {
      return;
    }

    try {
      await deleteFile(file.id);
      setMessage("文档已删除");

      if (activeFolderId) {
        const fileResult = await listFiles(activeFolderId);
        setFiles(fileResult.files);
      }
      await refreshTree();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除文档失败");
    }
  }

  function beginMoveFile(file: FileSummary) {
    const fallbackFolder =
      flatFolders.find((folder) => folder.id !== file.folderId)?.id ??
      file.folderId;

    setMovingFileId(file.id);
    setMoveTargetFolderId(fallbackFolder);
    setRenamingFileId(null);
    setOpenContentRowMenu(null);
  }

  function beginRenameFile(file: FileSummary) {
    setRenamingFileId(file.id);
    setFileRename(file.title);
    setMovingFileId(null);
    setOpenContentRowMenu(null);
  }

  function getFloatingMenuPosition(
    button: HTMLButtonElement,
    itemCount: number,
  ) {
    const rect = button.getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = itemCount * 36 + 2;
    const x = Math.max(
      8,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
    );
    const y =
      rect.bottom + 6 + menuHeight > window.innerHeight
        ? Math.max(8, rect.top - menuHeight - 6)
        : rect.bottom + 6;

    return { x, y };
  }

  function toggleContentRowMenu(
    targetType: "folder" | "file",
    id: string,
    button: HTMLButtonElement,
  ) {
    setOpenContentRowMenu((current) => {
      if (current?.targetType === targetType && current.id === id) {
        return null;
      }

      return {
        id,
        targetType,
        ...getFloatingMenuPosition(
          button,
          canManagePins && activeFolderId !== null ? 6 : 5,
        ),
      };
    });
  }

  function getFolderDescendantIds(folderId: string) {
    const byParentId = new Map<string | null, FlatFolderNode[]>();

    for (const folder of flatFolders) {
      const siblings = byParentId.get(folder.parentId) ?? [];
      siblings.push(folder);
      byParentId.set(folder.parentId, siblings);
    }

    const descendants = new Set<string>();
    const stack = [...(byParentId.get(folderId) ?? [])];

    while (stack.length > 0) {
      const folder = stack.pop();

      if (!folder) {
        continue;
      }

      descendants.add(folder.id);
      stack.push(...(byParentId.get(folder.id) ?? []));
    }

    return descendants;
  }

  function beginCreateFolder(parentId: string | null = activeFolderId) {
    setFolderParentId(parentId ?? "");
    setFolderName("");
    setShowCreateFolder(true);
    setShowCreateMenu(false);
  }

  function folderPathLabel(folderId: string) {
    const byId = new Map(flatFolders.map((folder) => [folder.id, folder]));
    const path: string[] = [];
    let current = byId.get(folderId);

    while (current) {
      path.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    return path.join(" / ");
  }

  function beginMoveFolder(folder: FolderNode) {
    const blockedIds = getFolderDescendantIds(folder.id);
    const fallbackFolder =
      flatFolders.find(
        (candidate) =>
          candidate.id !== folder.id && !blockedIds.has(candidate.id),
      )?.id ?? "";

    setMovingFolderId(folder.id);
    setFolderMoveTargetId(folder.parentId ?? fallbackFolder);
    setOpenContentRowMenu(null);
  }

  async function onMoveFolder(
    event: FormEvent<HTMLFormElement>,
    folder: FolderNode,
  ) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const nextParentId = folderMoveTargetId || null;

    if (nextParentId === folder.parentId) {
      setMovingFolderId(null);
      return;
    }

    try {
      await updateFolder({
        folderId: folder.id,
        parentId: nextParentId,
      });
      setMovingFolderId(null);
      setFolderMoveTargetId("");
      setMessage("文件夹已移动");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移动文件夹失败");
    }
  }

  async function onMoveFile(
    event: FormEvent<HTMLFormElement>,
    file: FileSummary,
  ) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!moveTargetFolderId || moveTargetFolderId === file.folderId) {
      setMovingFileId(null);
      return;
    }

    try {
      await updateFile({
        fileId: file.id,
        folderId: moveTargetFolderId,
      });
      setMovingFileId(null);
      setMoveTargetFolderId("");
      setMessage("文档已移动");

      if (activeFolderId) {
        const fileResult = await listFiles(activeFolderId);
        setFiles(fileResult.files);
      }
      await refreshTree();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移动文档失败");
    }
  }

  async function onRenameFile(
    event: FormEvent<HTMLFormElement>,
    file: FileSummary,
  ) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const title = fileRename.trim();

    if (!title) {
      setError("文档名称不能为空");
      return;
    }

    if (title === file.title) {
      setRenamingFileId(null);
      setFileRename("");
      return;
    }

    try {
      await updateFile({ fileId: file.id, title });
      setRenamingFileId(null);
      setFileRename("");
      setMessage("文档已重命名");

      if (activeFolderId) {
        const fileResult = await listFiles(activeFolderId);
        setFiles(fileResult.files);
      }
      await refreshTree();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重命名文档失败");
    }
  }

  async function onRenameFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!activeFolderId) {
      setError("请先选择文件夹");
      return;
    }

    try {
      await updateFolder({
        folderId: editingFolderId ?? activeFolderId,
        name: folderRename,
      });
      setEditingFolderId(null);
      setMessage("文件夹已重命名");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重命名文件夹失败");
    }
  }

  function beginDeleteFolder(folder: FolderNode) {
    const descendants = getFolderDescendantIds(folder.id);
    const subtreeIds = new Set([folder.id, ...descendants]);
    const subtreeFileCount = flatFolders.reduce(
      (count, item) =>
        subtreeIds.has(item.id) ? count + item.fileCount : count,
      0,
    );

    setDeleteFolderTarget({
      id: folder.id,
      name: folder.name,
      descendantCount: descendants.size,
      fileCount: subtreeFileCount,
    });
    setDeleteFolderStep(1);
    setDeleteFolderConfirmation("");
    setOpenContentRowMenu(null);
  }

  function closeDeleteFolderDialog() {
    if (isDeletingFolder) return;
    setDeleteFolderTarget(null);
    setDeleteFolderStep(1);
    setDeleteFolderConfirmation("");
  }

  async function onDeleteFolder() {
    if (!deleteFolderTarget) return;

    setError(null);
    setMessage(null);
    setIsDeletingFolder(true);

    try {
      await deleteFolder(deleteFolderTarget.id, deleteFolderTarget.name);
      const removedFolderIds = getFolderDescendantIds(deleteFolderTarget.id);
      removedFolderIds.add(deleteFolderTarget.id);
      if (activeFolderId && removedFolderIds.has(activeFolderId)) {
        setActiveFolderId(null);
      }
      setDeleteFolderTarget(null);
      setDeleteFolderStep(1);
      setDeleteFolderConfirmation("");
      setMessage("文件夹及其中的内容已删除");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除文件夹失败");
    } finally {
      setIsDeletingFolder(false);
    }
  }

  function beginRenameFolder(folder: FolderNode) {
    setEditingFolderId(folder.id);
    setFolderRename(folder.name);
    setOpenContentRowMenu(null);
  }

  function onContentRowClick(
    event: ReactMouseEvent<HTMLTableRowElement>,
    item: ContentRowItem,
  ) {
    const target = event.target;

    if (
      target instanceof HTMLElement &&
      target.closest("a, button, [data-menu-root='true']")
    ) {
      return;
    }

    if (item.kind === "folder") {
      void selectFolder(item.folder.id);
    } else {
      window.open(contentDetail(item.file.id), "_blank", "noopener,noreferrer");
    }
  }

  function renderContentRowContextMenu(item: ContentRowItem) {
    const isFolder = item.kind === "folder";
    const id = isFolder ? item.folder.id : item.file.id;
    const label = isFolder ? item.folder.name : item.file.title;
    const targetType = isFolder ? "folder" : "file";

    if (
      openContentRowMenu?.targetType !== targetType ||
      openContentRowMenu.id !== id
    ) {
      return null;
    }

    const isPinned = pinnedTargetKeys.has(`${targetType}:${id}`);

    return (
      <div
        className="context-menu floating-context-menu content-row-context-menu"
        style={{
          left: openContentRowMenu.x,
          top: openContentRowMenu.y,
        }}
      >
        {isFolder ? (
          <button
            onClick={() => {
              setOpenContentRowMenu(null);
              void selectFolder(item.folder.id);
            }}
            type="button"
          >
            <Folder aria-hidden="true" />
            打开
          </button>
        ) : (
          <Link
            href={contentDetail(item.file.id)}
            rel="noopener noreferrer"
            target="_blank"
          >
            <FileText aria-hidden="true" />
            打开
          </Link>
        )}
        {canManagePins && activeFolderId !== null ? (
          <button
            disabled={isUpdatingPins}
            onClick={() =>
              void togglePinnedTarget({ targetType, targetId: id }, label)
            }
            type="button"
          >
            {isPinned ? (
              <PinOff aria-hidden="true" />
            ) : (
              <Pin aria-hidden="true" />
            )}
            {isPinned ? "取消置顶" : "置顶"}
          </button>
        ) : null}
        <button
          onClick={() =>
            isFolder
              ? beginRenameFolder(item.folder)
              : beginRenameFile(item.file)
          }
          type="button"
        >
          <Pencil aria-hidden="true" />
          重命名
        </button>
        <button
          onClick={() =>
            isFolder ? beginMoveFolder(item.folder) : beginMoveFile(item.file)
          }
          type="button"
        >
          <MoveRight aria-hidden="true" />
          移动到…
        </button>
        <button
          onClick={() =>
            void openPermissions({
              type: targetType,
              id,
              name: label,
              ...(isFolder ? { isRoot: item.folder.parentId === null } : {}),
            })
          }
          type="button"
        >
          <Users aria-hidden="true" />
          权限设置
        </button>
        <button
          className="danger"
          onClick={() => {
            if (isFolder) {
              beginDeleteFolder(item.folder);
            } else {
              setOpenContentRowMenu(null);
              void onDeleteFile(item.file);
            }
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" />
          {isFolder ? "删除文件夹" : "删除"}
        </button>
      </div>
    );
  }

  function renderFileInlineRows(file: FileSummary) {
    return (
      <>
        {renamingFileId === file.id ? (
          <tr className="content-inline-row">
            <td colSpan={3}>
              <form
                className="inline-rename-file"
                onSubmit={(event) => void onRenameFile(event, file)}
              >
                <span>文档名称</span>
                <input
                  autoFocus
                  className="input"
                  value={fileRename}
                  onChange={(event) => setFileRename(event.target.value)}
                />
                <button className="button secondary" type="submit">
                  保存
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setRenamingFileId(null);
                    setFileRename("");
                  }}
                  type="button"
                >
                  取消
                </button>
              </form>
            </td>
          </tr>
        ) : null}
        {movingFileId === file.id ? (
          <tr className="content-inline-row">
            <td colSpan={3}>
              <form
                className="inline-move-file"
                onSubmit={(event) => void onMoveFile(event, file)}
              >
                <span>移动到</span>
                <select
                  className="select"
                  value={moveTargetFolderId}
                  onChange={(event) =>
                    setMoveTargetFolderId(event.target.value)
                  }
                >
                  {flatFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {"  ".repeat(folder.depth)}
                      {folder.name}
                    </option>
                  ))}
                </select>
                <button className="button secondary" type="submit">
                  移动
                </button>
                <button
                  className="button secondary"
                  onClick={() => setMovingFileId(null)}
                  type="button"
                >
                  取消
                </button>
              </form>
            </td>
          </tr>
        ) : null}
      </>
    );
  }

  function renderPinnedTableRow(item: PinnedContentItem, index: number) {
    const isFolder = item.kind === "folder";
    const id = isFolder ? item.folder.id : item.file.id;
    const label = isFolder ? item.folder.name : item.file.title;
    const updatedAt = isFolder ? item.folder.updatedAt : item.file.updatedAt;

    return (
      <Fragment key={`${item.kind}:${id}`}>
        <tr
          className="content-pinned-row"
          onClick={(event) => onContentRowClick(event, item)}
        >
          <td data-label="文件名">
            {isFolder ? (
              <button
                className="content-folder-link"
                onClick={() => void selectFolder(item.folder.id)}
                title={label}
                type="button"
              >
                <Folder aria-hidden="true" />
                <span>{label}</span>
                <Pin aria-hidden="true" className="content-pin-marker" />
              </button>
            ) : (
              <Link
                aria-label={label}
                className="content-file-link"
                href={contentDetail(item.file.id)}
                rel="noopener noreferrer"
                target="_blank"
                title={label}
              >
                <FileText aria-hidden="true" />
                {item.file.status === "draft" ? (
                  <span aria-hidden="true" className="content-draft-tag">
                    草稿
                  </span>
                ) : null}
                <span>{label}</span>
                <Pin aria-hidden="true" className="content-pin-marker" />
              </Link>
            )}
          </td>
          <td data-label="最近更新">{formatDateTime(updatedAt)}</td>
          <td data-label="操作">
            <div className="content-pinned-actions" data-menu-root="true">
              {canManagePins ? (
                <>
                  <button
                    aria-label={`上移“${label}”`}
                    disabled={isUpdatingPins || index === 0}
                    onClick={() => void movePinnedItem(index, -1)}
                    title="上移"
                    type="button"
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    aria-label={`下移“${label}”`}
                    disabled={
                      isUpdatingPins || index === pinnedItems.length - 1
                    }
                    onClick={() => void movePinnedItem(index, 1)}
                    title="下移"
                    type="button"
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                </>
              ) : null}
              <button
                aria-label={`“${label}”${isFolder ? "文件夹" : "文档"}操作`}
                className="content-row-menu-button"
                onClick={(event) =>
                  toggleContentRowMenu(
                    isFolder ? "folder" : "file",
                    id,
                    event.currentTarget,
                  )
                }
                title={isFolder ? "文件夹操作" : "文档操作"}
                type="button"
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
              {renderContentRowContextMenu(item)}
            </div>
          </td>
        </tr>
        {!isFolder ? renderFileInlineRows(item.file) : null}
      </Fragment>
    );
  }

  function renderContentTreeRow(folder: FlatFolderNode) {
    const isCollapsed = collapsedFolderIds.has(folder.id);
    const hasChildren = folder.children.length > 0;

    return (
      <div className="tree-row-wrap" key={`folder:${folder.id}`}>
        {editingFolderId === folder.id ? (
          <form
            className="tree-inline-form"
            onSubmit={onRenameFolder}
            style={treeDepthStyle(folder.depth)}
          >
            <input
              autoFocus
              className="input compact-input"
              value={folderRename}
              onChange={(event) => setFolderRename(event.target.value)}
            />
            <button className="button secondary compact-button" type="submit">
              保存
            </button>
            <button
              className="button secondary compact-button"
              onClick={() => setEditingFolderId(null)}
              type="button"
            >
              取消
            </button>
          </form>
        ) : (
          <div
            className={`tree-item tree-folder-item${folder.id === activeFolderId ? " active" : ""}`}
            style={treeDepthStyle(folder.depth)}
          >
            {hasChildren ? (
              <button
                aria-label={`${isCollapsed ? "展开" : "折叠"}“${folder.name}”`}
                className="tree-toggle-button"
                onClick={() => toggleFolderCollapsed(folder.id)}
                title={isCollapsed ? "展开" : "折叠"}
                type="button"
              >
                {isCollapsed ? (
                  <ChevronRight aria-hidden="true" />
                ) : (
                  <ChevronDown aria-hidden="true" />
                )}
              </button>
            ) : (
              <span aria-hidden="true" className="tree-toggle-spacer" />
            )}
            <button
              className="tree-main-button"
              onClick={() => void selectFolder(folder.id)}
              type="button"
            >
              <span className="tree-label">
                <Folder aria-hidden="true" className="item-icon" />
                <span title={folder.name}>{folder.name}</span>
              </span>
            </button>
            {folder.fileCount > 0 ? (
              <em aria-hidden="true" className="tree-count">
                {folder.fileCount}
              </em>
            ) : null}
          </div>
        )}
        {movingFolderId === folder.id ? (
          <form
            className="tree-inline-form folder-move-form"
            onSubmit={(event) => void onMoveFolder(event, folder)}
            style={treeDepthStyle(folder.depth)}
          >
            <span>移动到</span>
            <select
              className="select"
              value={folderMoveTargetId}
              onChange={(event) => setFolderMoveTargetId(event.target.value)}
            >
              <option value="">顶层</option>
              {flatFolders
                .filter((candidate) => {
                  const blockedIds = getFolderDescendantIds(folder.id);
                  return (
                    candidate.id !== folder.id && !blockedIds.has(candidate.id)
                  );
                })
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {"  ".repeat(candidate.depth)}
                    {candidate.name}
                  </option>
                ))}
            </select>
            <button className="button secondary compact-button" type="submit">
              移动
            </button>
            <button
              className="button secondary compact-button"
              onClick={() => setMovingFolderId(null)}
              type="button"
            >
              取消
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  async function onGrantPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!permissionTarget || !grantGroupId) {
      setError("请选择授权对象和权限组");
      return;
    }

    try {
      await upsertPermissionGrant({
        targetType: permissionTarget.type,
        targetId: permissionTarget.id,
        groupId: grantGroupId,
        level: grantLevel,
      });
      const grantResult = await listPermissionGrants(
        permissionTarget.type,
        permissionTarget.id,
      );
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
      setMessage("权限已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存权限失败");
    }
  }

  async function onDeleteGrant(grantId: string) {
    setError(null);
    setMessage(null);

    if (!permissionTarget) {
      setError("请先选择授权对象");
      return;
    }

    try {
      await deletePermissionGrant(grantId);
      const grantResult = await listPermissionGrants(
        permissionTarget.type,
        permissionTarget.id,
      );
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
      setMessage("已恢复继承上级权限");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移除授权失败");
    }
  }

  async function onUpdateGrantLevel(
    grant: PermissionGrantSummary,
    level: PermissionLevel,
  ) {
    setError(null);
    setMessage(null);

    if (!permissionTarget) {
      setError("请先选择授权对象");
      return;
    }

    try {
      await upsertPermissionGrant({
        targetType: permissionTarget.type,
        targetId: permissionTarget.id,
        groupId: grant.groupId ?? "",
        level,
      });
      const grantResult = await listPermissionGrants(
        permissionTarget.type,
        permissionTarget.id,
      );
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
      setMessage("权限已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新权限失败");
    }
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">文档工作区</p>
          <h1>文档</h1>
          <p className="muted">按文件夹组织教学文档，并管理文件权限。</p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <div className="panel-head content-path-head">
        <button
          aria-label="返回上一级"
          className={
            isRootView ? "breadcrumb-back is-hidden" : "breadcrumb-back"
          }
          disabled={isRootView}
          onClick={goToParentFolder}
          tabIndex={isRootView ? -1 : undefined}
          title="返回上一级"
          type="button"
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className="breadcrumb" aria-label="当前位置">
          {isRootView ? (
            <span>顶层</span>
          ) : (
            activeFolderPath.map((folder, index) => (
              <span key={folder.id}>
                {index > 0 ? <ChevronRight aria-hidden="true" /> : null}
                <button
                  onClick={() => void selectFolder(folder.id)}
                  title={folder.name}
                  type="button"
                >
                  {folder.name}
                </button>
              </span>
            ))
          )}
        </div>
        <div className="toolbar-row">
          <SortIconSelect
            onChange={setContentSortMode}
            options={SORT_OPTIONS}
            value={contentSortMode}
          />
          {canCreateFolderHere || canCreateFileHere ? (
            <div className="new-content-menu" data-menu-root="true">
              <button
                aria-expanded={showCreateMenu}
                aria-haspopup="menu"
                className="button secondary"
                onClick={() => {
                  setOpenContentRowMenu(null);
                  setShowCreateMenu((current) => !current);
                }}
                type="button"
              >
                <Plus aria-hidden="true" className="button-icon" />
                新建
                <ChevronDown aria-hidden="true" className="button-icon" />
              </button>
              {showCreateMenu ? (
                <div
                  className="context-menu right new-content-options"
                  role="menu"
                >
                  {canCreateFolderHere ? (
                    <button
                      onClick={() => beginCreateFolder(activeFolderId)}
                      role="menuitem"
                      type="button"
                    >
                      <Folder aria-hidden="true" />
                      新建文件夹
                    </button>
                  ) : null}
                  {canCreateFileHere ? (
                    <button
                      onClick={() => {
                        setShowCreateMenu(false);
                        setShowCreateFile(true);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <FileText aria-hidden="true" />
                      创建文档
                    </button>
                  ) : null}
                  {canCreateFileHere ? (
                    <MarkdownImportButton
                      menuItem
                      onImport={onImportMarkdown}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <section className="workbench files-layout">
        <aside className="folder-panel">
          <div className="file-tree">
            {visibleTreeFolders.map(renderContentTreeRow)}
            {flatFolders.length === 0 && !showCreateFolder ? (
              <div className="empty-panel">
                <strong>还没有文件夹</strong>
                <span>先创建一个位置来存放文件。</span>
                <button
                  className="button secondary"
                  onClick={() => beginCreateFolder(null)}
                  type="button"
                >
                  <Plus aria-hidden="true" className="button-icon" />
                  新建文件夹
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="workbench-main">
          <div className="table-wrap">
            <table className="table responsive-table content-items-table">
              <tbody>
                {pinnedItems.map(renderPinnedTableRow)}
                {unpinnedChildFolders.map((folder) => (
                  <tr
                    className="content-folder-row"
                    key={folder.id}
                    onClick={(event) =>
                      onContentRowClick(event, { kind: "folder", folder })
                    }
                  >
                    <td data-label="文件名">
                      <button
                        className="content-folder-link"
                        onClick={() => void selectFolder(folder.id)}
                        type="button"
                      >
                        <Folder aria-hidden="true" />
                        {folder.name}
                      </button>
                    </td>
                    <td data-label="最近更新">
                      {formatDateTime(folder.updatedAt)}
                    </td>
                    <td data-label="操作">
                      <div className="row-menu-wrap" data-menu-root="true">
                        <button
                          aria-label={`“${folder.name}”文件夹操作`}
                          className="icon-button subtle content-row-menu-button"
                          onClick={(event) =>
                            toggleContentRowMenu(
                              "folder",
                              folder.id,
                              event.currentTarget,
                            )
                          }
                          title="文件夹操作"
                          type="button"
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </button>
                        {renderContentRowContextMenu({
                          kind: "folder",
                          folder,
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
                {unpinnedFiles.map((file) => (
                  <Fragment key={file.id}>
                    <tr
                      className="content-file-row"
                      onClick={(event) =>
                        onContentRowClick(event, { kind: "file", file })
                      }
                    >
                      <td data-label="文件名">
                        <Link
                          aria-label={file.title}
                          className="content-file-link"
                          href={contentDetail(file.id)}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <FileText aria-hidden="true" />
                          {file.status === "draft" ? (
                            <span
                              aria-hidden="true"
                              className="content-draft-tag"
                            >
                              草稿
                            </span>
                          ) : null}
                          {file.title}
                        </Link>
                      </td>
                      <td data-label="最近更新">
                        {formatDateTime(file.updatedAt)}
                      </td>
                      <td data-label="操作">
                        <div className="row-menu-wrap" data-menu-root="true">
                          <button
                            aria-label={`“${file.title}”文档操作`}
                            className="icon-button subtle content-row-menu-button"
                            onClick={(event) =>
                              toggleContentRowMenu(
                                "file",
                                file.id,
                                event.currentTarget,
                              )
                            }
                            title="文档操作"
                            type="button"
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </button>
                          {renderContentRowContextMenu({ kind: "file", file })}
                        </div>
                      </td>
                    </tr>
                    {renderFileInlineRows(file)}
                  </Fragment>
                ))}
                {pinnedItems.length === 0 &&
                unpinnedChildFolders.length === 0 &&
                unpinnedFiles.length === 0 ? (
                  <tr className="content-empty-row">
                    <td className="empty-cell" colSpan={3}>
                      {isRootView ? (
                        <div className="empty-panel">
                          <strong>还没有文件夹</strong>
                          <span>先创建一个位置来存放文件。</span>
                          <button
                            className="button secondary"
                            onClick={() => beginCreateFolder(null)}
                            type="button"
                          >
                            <Plus aria-hidden="true" className="button-icon" />
                            新建文件夹
                          </button>
                        </div>
                      ) : (
                        <div className="empty-panel">
                          <strong>当前文件夹还是空的</strong>
                          <span>可以新建文档、教案、课程或练习集。</span>
                          <button
                            className="button secondary"
                            onClick={() => setShowCreateFile(true)}
                            type="button"
                          >
                            <Plus aria-hidden="true" className="button-icon" />
                            创建文档
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {showPermissions ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-panel permission-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-head">
              <div>
                <h2>
                  {permissionTarget?.type === "file"
                    ? "文档权限"
                    : "文件夹权限"}
                </h2>
                <p className="muted">{permissionTarget?.name ?? "当前文档"}</p>
              </div>
              <button
                className="icon-button subtle"
                onClick={() => setShowPermissions(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body permission-panel">
              <div
                className={`permission-inheritance-summary ${groupGrants.length > 0 ? "has-overrides" : ""}`}
              >
                <strong>
                  {groupGrants.length > 0
                    ? "包含例外权限"
                    : permissionTarget?.isRoot
                      ? "沿用文档默认权限"
                      : "沿用上级权限"}
                </strong>
                <span>
                  {groupGrants.length > 0
                    ? `当前${permissionTarget?.type === "file" ? "文档" : "文件夹"}为 ${groupGrants.length} 个权限组单独设置；其他权限继续从上级继承。`
                    : permissionTarget?.isRoot
                      ? "当前顶层文件夹没有单独设置，权限会随管理中心的文档默认权限自动变化。"
                      : `当前${permissionTarget?.type === "file" ? "文档" : "文件夹"}没有单独设置，权限会随上级文件夹自动变化。`}
                </span>
              </div>
              <div className="panel-title-row">
                <h2>
                  <Users aria-hidden="true" className="heading-icon" />
                  当前项目的例外
                </h2>
                <span className="badge">{groupGrants.length} 项</span>
              </div>
              {canManageGrants ? (
                <form
                  className="permission-add-row"
                  onSubmit={onGrantPermission}
                >
                  <select
                    aria-label="选择权限组"
                    className="select"
                    value={grantGroupId}
                    onChange={(event) => setGrantGroupId(event.target.value)}
                  >
                    {availableGrantGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}（{group.memberCount} 人）
                      </option>
                    ))}
                    {availableGrantGroups.length === 0 ? (
                      <option value="">没有可添加权限组</option>
                    ) : null}
                  </select>
                  <select
                    aria-label="选择权限级别"
                    className="select"
                    value={grantLevel}
                    onChange={(event) =>
                      setGrantLevel(event.target.value as PermissionLevel)
                    }
                  >
                    <option value="viewer">可查看</option>
                    <option value="lecturer">可制作课件</option>
                    <option value="editor">可编辑</option>
                    <option value="owner">可管理</option>
                    <option value="no_access">禁止访问</option>
                  </select>
                  <button
                    className="button"
                    disabled={
                      !grantGroupId || availableGrantGroups.length === 0
                    }
                    type="submit"
                  >
                    添加例外
                  </button>
                </form>
              ) : (
                <p className="muted">你没有调整这个文件夹权限的权限。</p>
              )}
              <div className="grant-list">
                {groupGrants.map((grant) => (
                  <div className="grant-row" key={grant.id}>
                    <span
                      className="grant-member"
                      title={
                        grant.group?.description ?? grant.group?.name ?? ""
                      }
                    >
                      <strong>{grant.group?.name}</strong>
                      <small>
                        {grant.group?.memberCount ?? 0} 人 · 当前项目单独设置
                        {inheritedFallbackByGroupId.get(grant.groupId)
                          ? `，恢复后为${permissionLabel(inheritedFallbackByGroupId.get(grant.groupId)?.level)}（来自「${inheritedFallbackByGroupId.get(grant.groupId)?.inheritedFrom.targetName}」）`
                          : "，恢复后不再从上级获得权限"}
                      </small>
                    </span>
                    {canManageGrants ? (
                      <select
                        className="grant-select"
                        value={grant.level}
                        onChange={(event) =>
                          void onUpdateGrantLevel(
                            grant,
                            event.target.value as PermissionLevel,
                          )
                        }
                      >
                        <option value="viewer">可查看</option>
                        <option value="lecturer">可制作课件</option>
                        <option value="editor">可编辑</option>
                        <option value="owner">可管理</option>
                        <option value="no_access">禁止访问</option>
                      </select>
                    ) : (
                      <span className="grant-level">
                        {permissionLabel(grant.level)}
                      </span>
                    )}
                    {canManageGrants ? (
                      <button
                        className="inline-icon-button"
                        onClick={() => void onDeleteGrant(grant.id)}
                        type="button"
                        title="恢复继承"
                      >
                        <RotateCcw aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
                {groupGrants.length === 0 ? (
                  <div className="empty-panel compact">
                    <strong>没有例外权限</strong>
                    <span>
                      {permissionTarget?.isRoot
                        ? "全部权限都沿用管理中心的文档默认权限。"
                        : "全部权限都沿用上级；通常只需在文件夹层统一管理。"}
                    </span>
                  </div>
                ) : null}
              </div>
              {visibleInheritedGrants.length > 0 ? (
                <section className="permission-inherited-section">
                  <div className="panel-title-row">
                    <h2>
                      {permissionTarget?.isRoot
                        ? "从文档默认权限继承"
                        : "从上级继承"}
                    </h2>
                    <span className="badge">
                      {visibleInheritedGrants.length} 项
                    </span>
                  </div>
                  <div className="grant-list inherited-grant-list">
                    {visibleInheritedGrants.map((grant) => (
                      <div className="grant-row inherited" key={grant.id}>
                        <span className="grant-member">
                          <strong>{grant.group?.name ?? "权限组"}</strong>
                          <small>
                            {grant.group?.memberCount ?? 0} 人 · 来自「
                            {grant.inheritedFrom.targetName}」
                          </small>
                        </span>
                        <span className="grant-level">
                          {permissionLabel(grant.level)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {deleteFolderTarget ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="delete-folder-title"
            aria-modal="true"
            className="modal-panel folder-delete-modal"
            role="dialog"
          >
            <div className="modal-head">
              <h2 id="delete-folder-title">
                {deleteFolderStep === 1 ? "删除文件夹？" : "再次确认删除"}
              </h2>
              <button
                className="icon-button subtle"
                disabled={isDeletingFolder}
                onClick={closeDeleteFolderDialog}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              {deleteFolderStep === 1 ? (
                <>
                  <div className="folder-delete-warning">
                    <strong>此操作无法撤销</strong>
                    <span>
                      {`将永久删除“${deleteFolderTarget.name}”以及其中的${deleteFolderTarget.descendantCount}个子文件夹和${deleteFolderTarget.fileCount}个文档。`}
                    </span>
                  </div>
                  <p className="muted">
                    上传的附件会保留在文件库中，但会解除与被删除文档的归属关系。
                  </p>
                </>
              ) : (
                <label className="label">
                  输入文件夹名称“{deleteFolderTarget.name}”以确认
                  <input
                    autoFocus
                    className="input"
                    disabled={isDeletingFolder}
                    value={deleteFolderConfirmation}
                    onChange={(event) =>
                      setDeleteFolderConfirmation(event.target.value)
                    }
                  />
                </label>
              )}
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={isDeletingFolder}
                  onClick={
                    deleteFolderStep === 1
                      ? closeDeleteFolderDialog
                      : () => {
                          setDeleteFolderStep(1);
                          setDeleteFolderConfirmation("");
                        }
                  }
                  type="button"
                >
                  {deleteFolderStep === 1 ? "取消" : "返回"}
                </button>
                {deleteFolderStep === 1 ? (
                  <button
                    className="button danger"
                    onClick={() => setDeleteFolderStep(2)}
                    type="button"
                  >
                    继续删除
                  </button>
                ) : (
                  <button
                    className="button danger"
                    disabled={
                      isDeletingFolder ||
                      deleteFolderConfirmation !== deleteFolderTarget.name
                    }
                    onClick={() => void onDeleteFolder()}
                    type="button"
                  >
                    {isDeletingFolder ? "正在删除…" : "永久删除"}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {showCreateFolder ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-panel" onSubmit={onCreateFolder}>
            <div className="modal-head">
              <h2>新建文件夹</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowCreateFolder(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <label className="label">
                文件夹名称
                <input
                  autoFocus
                  className="input"
                  placeholder="例如：基础培训"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                />
              </label>
              <label className="label">
                创建位置
                <select
                  className="select"
                  value={folderParentId}
                  onChange={(event) => setFolderParentId(event.target.value)}
                >
                  <option value="">顶层</option>
                  {flatFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folderPathLabel(folder.id)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="notice-box">
                <span>
                  将创建在：
                  {folderParentId ? folderPathLabel(folderParentId) : "顶层"}
                </span>
              </div>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setShowCreateFolder(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="button" type="submit">
                  创建文件夹
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {showCreateFile ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-panel" onSubmit={onCreateFile}>
            <div className="modal-head">
              <h2>创建文档</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowCreateFile(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <label className="label">
                文档名称
                <input
                  autoFocus
                  className="input"
                  placeholder="例如：第 1 周课件"
                  value={fileTitle}
                  onChange={(event) => setFileTitle(event.target.value)}
                />
              </label>
              <div className="notice-box">
                <span>
                  将创建在：
                  {activeFolderPath.map((folder) => folder.name).join(" / ") ||
                    "当前文件夹"}
                </span>
              </div>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setShowCreateFile(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="button" type="submit">
                  创建文档
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
