"use client";

import {
  Fragment,
  ChangeEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  X,
  File as FileIcon,
  FileText,
  Folder,
  LayoutGrid,
  MoreHorizontal,
  MoveRight,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Rows3,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import type {
  ContentPinTarget,
  FileSummary,
  FolderAssetSummary,
  FolderNode,
  PermissionLevel,
  UserSummary,
  UserTagSummary,
} from "@liveboard/shared";
import {
  getResourceNameError,
  normalizeResourceName,
} from "@liveboard/shared/resource-name";
import {
  createFile,
  createFolder,
  apiResourceUrl,
  assetDownloadUrl,
  deleteFile,
  deleteFolder,
  deleteLibraryAsset,
  deletePermissionGrant,
  getFolderTree,
  importMarkdown,
  listAssignablePermissionUsers,
  listFiles,
  listPermissionGrants,
  InheritedPermissionGrantSummary,
  PermissionGrantSummary,
  renameAsset,
  updateFile,
  updateFolder,
  updateContentPins,
  uploadAssetDirect,
  upsertPermissionGrant,
} from "@/lib/api";
import { formatRelativeTime, permissionLabel } from "@/lib/labels";
import { APP_ROUTES, contentDetail } from "@/lib/routes";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { SortIconSelect } from "@/components/SortIconSelect";
import { PermissionUserPicker } from "@/components/PermissionUserPicker";
import { AssetPreviewDialog } from "@/components/asset-preview/AssetPreviewDialog";
import { UploadTaskToast } from "@/components/upload/UploadTaskToast";
import {
  prepareUploadJobs,
  useUploadTask,
} from "@/components/upload/useUploadTask";
import { MarkdownImportButton } from "./MarkdownImportButton";
import {
  SkeletonRows,
  TableSkeletonRows,
} from "@/components/system/ProgressiveLoading";
import {
  FeedbackNotice,
  useFeedbackNotice,
} from "@/components/system/FeedbackNotice";

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
  targetType: "folder" | "file" | "asset";
  surface: "tree" | "list" | "grid";
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
type ContentView = "list" | "grid";

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

// 置顶只影响同级内的先后：置顶项按 pinnedOrder 排到前面，其余保持接口顺序
// （sortOrder → name）。Array.sort 是稳定的，所以未置顶的相对次序不会被打乱。
function sortFoldersByPin(folders: FolderNode[]): FolderNode[] {
  return [...folders].sort((left, right) => {
    if (left.pinnedOrder !== null && right.pinnedOrder !== null) {
      return left.pinnedOrder - right.pinnedOrder;
    }

    if (left.pinnedOrder !== null) return -1;
    if (right.pinnedOrder !== null) return 1;
    return 0;
  });
}

// 左侧位置树只展示文件夹，作为纯粹的层级导航；文档统一在右侧表格呈现。
// 排序必须和右侧一致：置顶是「这个位置下的排列方式」，不是右侧表格的私有视图。
function flattenVisibleFolders(
  folders: FolderNode[],
  collapsedFolderIds: Set<string>,
  depth = 0,
): FlatFolderNode[] {
  return sortFoldersByPin(folders).flatMap((folder) => [
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
  const [standaloneAssets, setStandaloneAssets] = useState<
    FolderAssetSummary[]
  >([]);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const {
    tasks: uploadTasks,
    uploadFiles,
    cancelUpload,
    dismissUpload,
  } = useUploadTask();
  const [renamingAsset, setRenamingAsset] = useState<FolderAssetSummary | null>(
    null,
  );
  const [previewAsset, setPreviewAsset] = useState<FolderAssetSummary | null>(
    null,
  );
  const [assetRename, setAssetRename] = useState("");
  const assetInputRef = useRef<HTMLInputElement>(null);
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
  const [permissionUsers, setPermissionUsers] = useState<UserSummary[]>([]);
  const [permissionTags, setPermissionTags] = useState<UserTagSummary[]>([]);
  const [grants, setGrants] = useState<PermissionGrantSummary[]>([]);
  const [inheritedGrants, setInheritedGrants] = useState<
    InheritedPermissionGrantSummary[]
  >([]);
  const [canManageGrants, setCanManageGrants] = useState(false);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantLevel, setGrantLevel] = useState<PermissionLevel>("viewer");
  const [messageNotice, setMessage] = useFeedbackNotice();
  const [errorNotice, setError] = useFeedbackNotice();
  const message = messageNotice?.text ?? null;
  const error = errorNotice?.text ?? null;
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<DeleteFolderTarget | null>(null);
  const [deleteFolderStep, setDeleteFolderStep] = useState<1 | 2>(1);
  const [deleteFolderConfirmation, setDeleteFolderConfirmation] = useState("");
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [contentSortMode, setContentSortMode] =
    useState<ContentSortMode>("updated");
  const [contentSearchQuery, setContentSearchQuery] = useState("");
  const [contentView, setContentView] = useState<ContentView>("list");
  const [isBreadcrumbOverflowOpen, setIsBreadcrumbOverflowOpen] =
    useState(false);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [canManagePins, setCanManagePins] = useState(false);
  const [isUpdatingPins, setIsUpdatingPins] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);

  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);
  const visibleTreeFolders = useMemo(
    () => flattenVisibleFolders(folders, collapsedFolderIds),
    [collapsedFolderIds, folders],
  );
  const activeFolder = flatFolders.find(
    (folder) => folder.id === activeFolderId,
  );
  const isRootView = activeFolderId === null;
  const canCreateFolderHere = isRootView
    ? canManagePins
    : canCreateFolder(activeFolder?.permission ?? null);
  const canCreateFileHere = isRootView
    ? false
    : canCreateFile(activeFolder?.permission ?? null);
  const pinnedItems = useMemo(
    () => collectPinnedContent(activeFolder),
    [activeFolder],
  );
  const fileBeingRenamed =
    files.find((file) => file.id === renamingFileId) ??
    pinnedItems.find(
      (item): item is Extract<PinnedContentItem, { kind: "file" }> =>
        item.kind === "file" && item.file.id === renamingFileId,
    )?.file ??
    null;
  const fileBeingMoved =
    files.find((file) => file.id === movingFileId) ??
    pinnedItems.find(
      (item): item is Extract<PinnedContentItem, { kind: "file" }> =>
        item.kind === "file" && item.file.id === movingFileId,
    )?.file ??
    null;
  const folderBeingRenamed =
    flatFolders.find((folder) => folder.id === editingFolderId) ?? null;
  const folderBeingMoved =
    flatFolders.find((folder) => folder.id === movingFolderId) ?? null;
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
  const sortedAssets = useMemo(() => {
    const nextAssets = [...standaloneAssets];

    return nextAssets.sort((left, right) => {
      if (contentSortMode === "updated") {
        return (
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
        );
      }

      return left.filename.localeCompare(right.filename, "zh-CN");
    });
  }, [contentSortMode, standaloneAssets]);
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
  const normalizedContentSearchQuery = contentSearchQuery
    .trim()
    .toLocaleLowerCase();
  const visiblePinnedItems = useMemo(
    () =>
      pinnedItems.filter((item) => {
        const label =
          item.kind === "folder" ? item.folder.name : item.file.title;
        return (
          !normalizedContentSearchQuery ||
          label.toLocaleLowerCase().includes(normalizedContentSearchQuery)
        );
      }),
    [normalizedContentSearchQuery, pinnedItems],
  );
  const visibleChildFolders = useMemo(
    () =>
      unpinnedChildFolders.filter(
        (folder) =>
          !normalizedContentSearchQuery ||
          folder.name
            .toLocaleLowerCase()
            .includes(normalizedContentSearchQuery),
      ),
    [normalizedContentSearchQuery, unpinnedChildFolders],
  );
  const visibleFiles = useMemo(
    () =>
      unpinnedFiles.filter(
        (file) =>
          !normalizedContentSearchQuery ||
          file.title.toLocaleLowerCase().includes(normalizedContentSearchQuery),
      ),
    [normalizedContentSearchQuery, unpinnedFiles],
  );
  const visibleAssets = useMemo(
    () =>
      sortedAssets.filter(
        (asset) =>
          !normalizedContentSearchQuery ||
          asset.filename
            .toLocaleLowerCase()
            .includes(normalizedContentSearchQuery),
      ),
    [normalizedContentSearchQuery, sortedAssets],
  );
  const hasContentItems =
    pinnedItems.length +
      unpinnedChildFolders.length +
      unpinnedFiles.length +
      sortedAssets.length >
    0;
  const hasVisibleContentItems =
    visiblePinnedItems.length +
      visibleChildFolders.length +
      visibleFiles.length +
      visibleAssets.length >
    0;
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
  const collapsedBreadcrumbFolders =
    activeFolderPath.length > 2 ? activeFolderPath.slice(0, -1) : [];
  const visibleBreadcrumbFolders =
    collapsedBreadcrumbFolders.length > 0
      ? activeFolderPath.slice(-1)
      : activeFolderPath;
  useDocumentTitle(activeFolderPath.at(-1)?.name ?? "文档");
  const directGrantUserIds = useMemo(
    () => new Set(grants.map((grant) => grant.userId)),
    [grants],
  );
  const inheritedFallbackByUserId = useMemo(
    () =>
      new Map(inheritedGrants.map((grant) => [grant.userId, grant] as const)),
    [inheritedGrants],
  );
  const visibleInheritedGrants = useMemo(
    () =>
      inheritedGrants.filter(
        (grant) => !grants.some((direct) => direct.userId === grant.userId),
      ),
    [grants, inheritedGrants],
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
    setLoadingTree(false);

    if (selectedFolderId) {
      await refreshFolderContents(selectedFolderId);
    } else {
      setFiles([]);
      setStandaloneAssets([]);
      setGrants([]);
      setInheritedGrants([]);
      setPermissionUsers([]);
      setPermissionTags([]);
      setGrantUserId("");
      setCanManageGrants(false);
    }
    setLoadingItems(false);
  }

  async function refreshFolderContents(folderId: string) {
    const fileResult = await listFiles(folderId);
    setFiles(fileResult.files);
    setStandaloneAssets(fileResult.standaloneAssets);
  }

  async function refreshTree() {
    const result = await getFolderTree();
    setFolders(result.folders);
    setCanManagePins(result.canManagePins);
  }

  async function openPermissions(target: PermissionTarget) {
    setOpenContentRowMenu(null);
    setError(null);

    try {
      const [grantResult, userResult] = await Promise.all([
        listPermissionGrants(target.type, target.id),
        listAssignablePermissionUsers({
          targetType: target.type,
          targetId: target.id,
        }),
      ]);
      setPermissionTarget(target);
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
      setPermissionUsers(userResult.users);
      setPermissionTags(userResult.tags);
      setGrantUserId("");
      setCanManageGrants(true);
      setShowPermissions(true);
    } catch (caught) {
      setCanManageGrants(false);
      setError(caught instanceof Error ? caught.message : "加载权限失败");
    }
  }

  useEffect(() => {
    load()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载失败");
      })
      .finally(() => {
        setLoadingTree(false);
        setLoadingItems(false);
      });
    // The initial load should only run once; actions call load explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function closeFloatingMenus() {
      setOpenContentRowMenu(null);
      setShowCreateMenu(false);
      setIsBreadcrumbOverflowOpen(false);
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
    setContentSearchQuery("");
    setIsBreadcrumbOverflowOpen(false);
    setShowCreateMenu(false);
    setError(null);
    await refreshFolderContents(folderId);
  }

  function selectRoot() {
    setActiveFolderId(null);
    persistActiveFolder(null);
    setContentSearchQuery("");
    setIsBreadcrumbOverflowOpen(false);
    setFiles([]);
    setStandaloneAssets([]);
    setGrants([]);
    setInheritedGrants([]);
    setPermissionUsers([]);
    setPermissionTags([]);
    setCanManageGrants(false);
    setShowCreateMenu(false);
    setOpenContentRowMenu(null);
    setError(null);
  }

  async function onCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const nameError = getResourceNameError(folderName, "文件夹名称");
    if (nameError) {
      setError(nameError);
      return;
    }

    try {
      await createFolder({
        name: normalizeResourceName(folderName),
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

    const nameError = getResourceNameError(fileTitle, "文档名称");
    if (nameError) {
      setError(nameError);
      return;
    }

    try {
      await createFile({
        folderId: activeFolderId,
        title: normalizeResourceName(fileTitle),
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

  async function onUploadAsset(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length === 0 || !activeFolderId) return;
    const jobs = prepareUploadJobs(
      selectedFiles,
      standaloneAssets.map((asset) => asset.filename),
      "当前文件夹中已存在同名文件",
    );
    setUploadingAsset(true);
    setError(null);
    setMessage(null);
    try {
      const outcomes = await uploadFiles(jobs, (job, options) =>
        uploadAssetDirect(
          { file: job.file, folderId: activeFolderId },
          options,
        ),
      );
      const successCount = outcomes.filter(
        (outcome) => outcome.result !== undefined,
      ).length;
      if (successCount > 0) {
        setMessage(
          successCount === 1 ? "文件已上传" : `${successCount} 个文件已上传`,
        );
        await refreshFolderContents(activeFolderId);
      }
    } finally {
      setUploadingAsset(false);
    }
  }

  async function onRenameAssetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renamingAsset) return;
    const nameError = getResourceNameError(assetRename, "文件名称");
    if (nameError) {
      setError(nameError);
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await renameAsset(renamingAsset.id, normalizeResourceName(assetRename));
      setMessage("文件已重命名");
      setRenamingAsset(null);
      setAssetRename("");
      if (activeFolderId) {
        await refreshFolderContents(activeFolderId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重命名文件失败");
    }
  }

  async function onDeleteAsset(asset: FolderAssetSummary) {
    setError(null);
    setMessage(null);
    if (!window.confirm(`永久删除“${asset.filename}”？此操作无法撤销。`)) {
      return;
    }
    try {
      await deleteLibraryAsset(asset.id);
      setMessage("文件已删除");
      if (activeFolderId) {
        await refreshFolderContents(activeFolderId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除文件失败");
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
        await refreshFolderContents(activeFolderId);
      }
      await refreshTree();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除文档失败");
    }
  }

  function beginMoveFile(file: FileSummary) {
    setMovingFileId(file.id);
    setMoveTargetFolderId(file.folderId);
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

  function getContentRowMenuItemCount() {
    return canManagePins && activeFolderId !== null ? 6 : 5;
  }

  function toggleContentRowMenu(
    targetType: ContentRowMenuState["targetType"],
    id: string,
    button: HTMLButtonElement,
    surface: ContentRowMenuState["surface"],
    itemCount: number,
  ) {
    setOpenContentRowMenu((current) => {
      if (
        current?.targetType === targetType &&
        current.id === id &&
        current.surface === surface
      ) {
        return null;
      }

      return {
        id,
        targetType,
        surface,
        ...getFloatingMenuPosition(button, itemCount),
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
    setMovingFolderId(folder.id);
    setFolderMoveTargetId(folder.parentId ?? "");
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
        await refreshFolderContents(activeFolderId);
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

    const nameError = getResourceNameError(fileRename, "文档名称");
    if (nameError) {
      setError(nameError);
      return;
    }
    const title = normalizeResourceName(fileRename);

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
        await refreshFolderContents(activeFolderId);
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

    const folderId = editingFolderId ?? activeFolderId;
    if (!folderId) {
      setError("请先选择文件夹");
      return;
    }

    const nameError = getResourceNameError(folderRename, "文件夹名称");
    if (nameError) {
      setError(nameError);
      return;
    }

    try {
      await updateFolder({
        folderId,
        name: normalizeResourceName(folderRename),
      });
      setEditingFolderId(null);
      setFolderRename("");
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
    event: ReactMouseEvent<HTMLElement>,
    item: ContentRowItem,
  ) {
    const target = event.target;

    if (
      target instanceof Element &&
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

  function onAssetRowClick(
    event: ReactMouseEvent<HTMLElement>,
    asset: FolderAssetSummary,
  ) {
    const target = event.target;

    if (
      target instanceof Element &&
      target.closest("a, button, [data-menu-root='true']")
    ) {
      return;
    }

    setPreviewAsset(asset);
  }

  function renderContentRowContextMenu(
    item: ContentRowItem,
    surface: ContentRowMenuState["surface"],
  ) {
    const isFolder = item.kind === "folder";
    const id = isFolder ? item.folder.id : item.file.id;
    const label = isFolder ? item.folder.name : item.file.title;
    const targetType = isFolder ? "folder" : "file";

    if (
      openContentRowMenu?.targetType !== targetType ||
      openContentRowMenu.id !== id ||
      openContentRowMenu.surface !== surface
    ) {
      return null;
    }

    const isPinned = pinnedTargetKeys.has(`${targetType}:${id}`);
    const canPinItem =
      canManagePins &&
      activeFolderId !== null &&
      (!isFolder || item.folder.parentId === activeFolderId);
    const canEditItem = isFolder
      ? canCreateFolder(item.folder.permission)
      : canCreateFile(activeFolder?.permission ?? null);
    const canManageItemPermissions =
      canManagePins || (isFolder && item.folder.permission === "owner");

    return (
      <div
        className="context-menu floating-context-menu content-row-context-menu"
        data-menu-root="true"
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
        {canPinItem ? (
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
        {canManageItemPermissions ? (
          <button
            onClick={() =>
              void openPermissions({
                type: targetType,
                id,
                name: label,
                isRoot: isFolder && item.folder.parentId === null,
              })
            }
            type="button"
          >
            <Users aria-hidden="true" />
            权限
          </button>
        ) : null}
        {canEditItem ? (
          <>
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
                isFolder
                  ? beginMoveFolder(item.folder)
                  : beginMoveFile(item.file)
              }
              type="button"
            >
              <MoveRight aria-hidden="true" />
              移动到…
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
          </>
        ) : null}
      </div>
    );
  }

  function renderAssetContextMenu(asset: FolderAssetSummary) {
    if (
      openContentRowMenu?.targetType !== "asset" ||
      openContentRowMenu.id !== asset.id
    ) {
      return null;
    }

    return (
      <div
        className="context-menu floating-context-menu content-row-context-menu"
        data-menu-root="true"
        style={{
          left: openContentRowMenu.x,
          top: openContentRowMenu.y,
        }}
      >
        <a
          href={assetDownloadUrl(asset.id)}
          onClick={() => setOpenContentRowMenu(null)}
        >
          <Download aria-hidden="true" />
          下载
        </a>
        <button
          onClick={() => {
            setOpenContentRowMenu(null);
            setRenamingAsset(asset);
            setAssetRename(asset.filename);
          }}
          type="button"
        >
          <Pencil aria-hidden="true" />
          重命名
        </button>
        <button
          className="danger"
          onClick={() => {
            setOpenContentRowMenu(null);
            void onDeleteAsset(asset);
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" />
          删除
        </button>
      </div>
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
          className="content-drive-row content-pinned-row"
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
          <td data-label="最近更新">{formatRelativeTime(updatedAt)}</td>
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
                onClick={(event) => {
                  event.stopPropagation();
                  toggleContentRowMenu(
                    isFolder ? "folder" : "file",
                    id,
                    event.currentTarget,
                    "list",
                    getContentRowMenuItemCount(),
                  );
                }}
                title={isFolder ? "文件夹操作" : "文档操作"}
                type="button"
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
              {renderContentRowContextMenu(item, "list")}
            </div>
          </td>
        </tr>
      </Fragment>
    );
  }

  function renderContentTreeRow(folder: FlatFolderNode) {
    const isCollapsed = collapsedFolderIds.has(folder.id);
    const hasChildren = folder.children.length > 0;

    return (
      <div className="tree-row-wrap" key={`folder:${folder.id}`}>
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
          <button
            aria-label={`“${folder.name}”文件夹操作`}
            className="tree-row-menu-button"
            onClick={(event) => {
              event.stopPropagation();
              toggleContentRowMenu(
                "folder",
                folder.id,
                event.currentTarget,
                "tree",
                getContentRowMenuItemCount(),
              );
            }}
            title="文件夹操作"
            type="button"
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
          {renderContentRowContextMenu({ kind: "folder", folder }, "tree")}
        </div>
      </div>
    );
  }

  function renderContentGridCard(
    item: ContentRowItem | PinnedContentItem,
    pinnedIndex?: number,
  ) {
    const isFolder = item.kind === "folder";
    const id = isFolder ? item.folder.id : item.file.id;
    const label = isFolder ? item.folder.name : item.file.title;
    const updatedAt = isFolder ? item.folder.updatedAt : item.file.updatedAt;
    const isPinned = pinnedTargetKeys.has(
      `${isFolder ? "folder" : "file"}:${id}`,
    );

    return (
      <article
        className={`content-drive-card content-drive-card--${isFolder ? "folder" : "document"}${isPinned ? " content-drive-card--pinned" : ""}`}
        key={`${item.kind}:${id}`}
      >
        {isFolder ? (
          <button
            className="content-drive-card-main"
            onClick={() => void selectFolder(item.folder.id)}
            type="button"
          >
            <span aria-hidden="true" className="content-drive-card-icon">
              <Folder />
            </span>
            <strong title={label}>{label}</strong>
          </button>
        ) : (
          <Link
            aria-label={label}
            className="content-drive-card-main"
            href={contentDetail(item.file.id)}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span aria-hidden="true" className="content-drive-card-icon">
              <FileText />
            </span>
            <strong title={label}>{label}</strong>
            {item.file.status === "draft" ? (
              <span aria-hidden="true" className="content-draft-tag">
                草稿
              </span>
            ) : null}
          </Link>
        )}
        <div className="content-drive-card-footer">
          <span className="content-drive-card-meta">
            {isPinned ? <Pin aria-hidden="true" /> : null}
            {formatRelativeTime(updatedAt)}
          </span>
          <div className="content-drive-card-actions" data-menu-root="true">
            {pinnedIndex !== undefined && canManagePins ? (
              <>
                <button
                  aria-label={`上移“${label}”`}
                  disabled={isUpdatingPins || pinnedIndex === 0}
                  onClick={() => void movePinnedItem(pinnedIndex, -1)}
                  title="上移"
                  type="button"
                >
                  <ArrowUp aria-hidden="true" />
                </button>
                <button
                  aria-label={`下移“${label}”`}
                  disabled={
                    isUpdatingPins || pinnedIndex === pinnedItems.length - 1
                  }
                  onClick={() => void movePinnedItem(pinnedIndex, 1)}
                  title="下移"
                  type="button"
                >
                  <ArrowDown aria-hidden="true" />
                </button>
              </>
            ) : null}
            <button
              aria-label={`“${label}”${isFolder ? "文件夹" : "文档"}操作`}
              className="icon-button subtle content-row-menu-button"
              onClick={(event) => {
                toggleContentRowMenu(
                  isFolder ? "folder" : "file",
                  id,
                  event.currentTarget,
                  "grid",
                  getContentRowMenuItemCount(),
                );
              }}
              title={isFolder ? "文件夹操作" : "文档操作"}
              type="button"
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
            {renderContentRowContextMenu(item, "grid")}
          </div>
        </div>
      </article>
    );
  }

  function renderAssetGridCard(asset: FolderAssetSummary) {
    return (
      <article
        className="content-drive-card content-drive-card--asset"
        key={asset.id}
      >
        <a
          className="content-drive-card-main"
          href={apiResourceUrl(`/assets/${asset.id}`)}
          onClick={(event) => {
            event.preventDefault();
            setPreviewAsset(asset);
          }}
        >
          <span aria-hidden="true" className="content-drive-card-icon">
            <FileIcon />
          </span>
          <strong title={asset.filename}>{asset.filename}</strong>
          <small>{formatFileSize(asset.sizeBytes)}</small>
        </a>
        <div className="content-drive-card-footer">
          <span className="content-drive-card-meta">
            {formatRelativeTime(asset.updatedAt)}
          </span>
          <div className="content-drive-card-actions" data-menu-root="true">
            {asset.canManage ? (
              <>
                <button
                  aria-label={`“${asset.filename}”文件操作`}
                  className="icon-button subtle content-row-menu-button"
                  onClick={(event) => {
                    toggleContentRowMenu(
                      "asset",
                      asset.id,
                      event.currentTarget,
                      "grid",
                      3,
                    );
                  }}
                  title="文件操作"
                  type="button"
                >
                  <MoreHorizontal aria-hidden="true" />
                </button>
                {renderAssetContextMenu(asset)}
              </>
            ) : (
              <a
                aria-label={`下载“${asset.filename}”`}
                className="icon-button subtle"
                href={assetDownloadUrl(asset.id)}
                title="下载"
              >
                <Download aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </article>
    );
  }

  function renderContentEmptyState() {
    if (hasVisibleContentItems || loadingItems) return null;

    if (hasContentItems) {
      return (
        <div className="content-drive-empty">
          <Search aria-hidden="true" />
          <strong>没有匹配的项目</strong>
          <span>换个关键词，或清除搜索查看当前目录。</span>
          <button
            className="button secondary"
            onClick={() => setContentSearchQuery("")}
            type="button"
          >
            清除搜索
          </button>
        </div>
      );
    }

    return (
      <div className="content-drive-empty">
        <Folder aria-hidden="true" />
        <strong>{isRootView ? "还没有文件夹" : "当前文件夹还是空的"}</strong>
        <span>
          {isRootView
            ? "创建文件夹后，就可以开始整理课程文档。"
            : "在这里创建文档或上传文件。"}
        </span>
        {isRootView && canCreateFolderHere ? (
          <button
            className="button secondary"
            onClick={() => beginCreateFolder(null)}
            type="button"
          >
            <Plus aria-hidden="true" className="button-icon" />
            新建文件夹
          </button>
        ) : null}
        {!isRootView && canCreateFileHere ? (
          <button
            className="button secondary"
            onClick={() => setShowCreateFile(true)}
            type="button"
          >
            <Plus aria-hidden="true" className="button-icon" />
            创建文档
          </button>
        ) : null}
      </div>
    );
  }

  async function onGrantPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!permissionTarget || !grantUserId) {
      setError("请选择成员");
      return;
    }

    try {
      await upsertPermissionGrant({
        targetType: permissionTarget.type,
        targetId: permissionTarget.id,
        userId: grantUserId,
        level: grantLevel,
      });
      const grantResult = await listPermissionGrants(
        permissionTarget.type,
        permissionTarget.id,
      );
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
      setGrantUserId("");
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
        userId: grant.userId,
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
    <div className="workspace content-workspace">
      <FeedbackNotice notice={errorNotice} tone="error" />
      <FeedbackNotice notice={messageNotice} tone="success" />

      <section className="content-drive-layout">
        <aside className="content-drive-sidebar" aria-label="文档位置">
          <nav className="content-drive-nav" aria-label="文档快捷入口">
            <button
              className={isRootView ? "active" : ""}
              onClick={() => void selectRoot()}
              type="button"
            >
              <Folder aria-hidden="true" />
              文档
            </button>
            <Link href={APP_ROUTES.ai}>
              <Bot aria-hidden="true" />
              AI
            </Link>
            <Link href={APP_ROUTES.library}>
              <Paperclip aria-hidden="true" />
              文件
            </Link>
          </nav>
          <div className="content-drive-sidebar-title">
            <span>文件夹</span>
          </div>
          <div className="file-tree content-drive-tree">
            {loadingTree ? <SkeletonRows compact count={6} /> : null}
            {visibleTreeFolders.map(renderContentTreeRow)}
            {!loadingTree && flatFolders.length === 0 && !showCreateFolder ? (
              <div className="content-drive-sidebar-empty">
                <strong>还没有文件夹</strong>
                <span>从右上角新建开始整理。</span>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="content-drive-main">
          <div className="content-drive-toolbar">
            <div className="content-drive-location">
              <div aria-label="当前位置" className="breadcrumb">
                {isRootView ? (
                  <span className="content-breadcrumb-root">文档</span>
                ) : null}
                {!isRootView ? (
                  <span className="content-breadcrumb-root">
                    <button onClick={() => void selectRoot()} type="button">
                      文档
                    </button>
                  </span>
                ) : null}
                {collapsedBreadcrumbFolders.length > 0 ? (
                  <div
                    className="content-breadcrumb-overflow"
                    data-menu-root="true"
                  >
                    <ChevronRight aria-hidden="true" />
                    <button
                      aria-expanded={isBreadcrumbOverflowOpen}
                      aria-haspopup="menu"
                      aria-label="展开上级路径"
                      onClick={() =>
                        setIsBreadcrumbOverflowOpen((isOpen) => !isOpen)
                      }
                      title="展开上级路径"
                      type="button"
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </button>
                    {isBreadcrumbOverflowOpen ? (
                      <div
                        className="content-breadcrumb-overflow-menu"
                        role="menu"
                      >
                        {collapsedBreadcrumbFolders.map((folder) => (
                          <button
                            key={folder.id}
                            onClick={() => void selectFolder(folder.id)}
                            role="menuitem"
                            title={folder.name}
                            type="button"
                          >
                            <Folder aria-hidden="true" />
                            <span>{folder.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {visibleBreadcrumbFolders.map((folder) => (
                  <span
                    className={`content-breadcrumb-item${folder.id === activeFolderId ? " is-current" : ""}`}
                    key={folder.id}
                  >
                    <ChevronRight aria-hidden="true" />
                    <button
                      onClick={() => void selectFolder(folder.id)}
                      title={folder.name}
                      type="button"
                    >
                      <span className="content-breadcrumb-label">
                        {folder.name}
                      </span>
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <label className="content-drive-search">
              <Search aria-hidden="true" />
              <input
                aria-label="搜索当前目录"
                onChange={(event) => setContentSearchQuery(event.target.value)}
                placeholder="搜索当前目录"
                value={contentSearchQuery}
              />
              {contentSearchQuery ? (
                <button
                  aria-label="清除目录搜索"
                  onClick={() => setContentSearchQuery("")}
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </label>

            <div className="content-drive-actions">
              <Link
                aria-label="打开 AI"
                className="content-drive-mobile-shortcut"
                href={APP_ROUTES.ai}
                title="AI"
              >
                <Bot aria-hidden="true" />
              </Link>
              <Link
                aria-label="打开文件"
                className="content-drive-mobile-shortcut"
                href={APP_ROUTES.library}
                title="文件"
              >
                <Paperclip aria-hidden="true" />
              </Link>
              <div
                aria-label="文档展示方式"
                className="segmented-control content-drive-view-toggle"
              >
                <button
                  aria-label="列表视图"
                  aria-pressed={contentView === "list"}
                  className={contentView === "list" ? "active" : ""}
                  onClick={() => setContentView("list")}
                  title="列表视图"
                  type="button"
                >
                  <Rows3 aria-hidden="true" strokeWidth={1.8} />
                </button>
                <button
                  aria-label="网格视图"
                  aria-pressed={contentView === "grid"}
                  className={contentView === "grid" ? "active" : ""}
                  onClick={() => setContentView("grid")}
                  title="网格视图"
                  type="button"
                >
                  <LayoutGrid aria-hidden="true" strokeWidth={1.8} />
                </button>
              </div>
              <SortIconSelect
                onChange={setContentSortMode}
                options={SORT_OPTIONS}
                value={contentSortMode}
              />
              {activeFolderId && canCreateFileHere ? (
                <>
                  <button
                    aria-label={uploadingAsset ? "正在上传文件" : "上传文件"}
                    className="button secondary content-drive-upload"
                    disabled={uploadingAsset}
                    onClick={() => assetInputRef.current?.click()}
                    title={uploadingAsset ? "上传中" : "上传文件"}
                    type="button"
                  >
                    <Upload aria-hidden="true" className="button-icon" />
                    <span>{uploadingAsset ? "上传中" : "上传"}</span>
                  </button>
                  <input
                    aria-label="上传文件到当前文件夹"
                    hidden
                    multiple
                    onChange={(event) => void onUploadAsset(event)}
                    ref={assetInputRef}
                    type="file"
                  />
                </>
              ) : null}
              {canCreateFolderHere || canCreateFileHere ? (
                <div className="new-content-menu" data-menu-root="true">
                  <button
                    aria-label="新建"
                    aria-expanded={showCreateMenu}
                    aria-haspopup="menu"
                    className="button content-create-button"
                    onClick={() => {
                      setOpenContentRowMenu(null);
                      setShowCreateMenu((current) => !current);
                    }}
                    title="新建"
                    type="button"
                  >
                    <Plus aria-hidden="true" className="button-icon" />
                    <span>新建</span>
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

          <div className="content-drive-content">
            {contentView === "list" ? (
              <div className="content-drive-list table-wrap">
                <table className="table responsive-table content-items-table content-drive-table">
                  <thead>
                    <tr>
                      <th scope="col">文件名</th>
                      <th scope="col">最近更新</th>
                      <th scope="col">
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingItems ? (
                      <TableSkeletonRows colSpan={3} count={6} />
                    ) : null}
                    {visiblePinnedItems.map((item) =>
                      renderPinnedTableRow(item, pinnedItems.indexOf(item)),
                    )}
                    {visibleChildFolders.map((folder) => (
                      <tr
                        className="content-drive-row content-folder-row"
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
                          {formatRelativeTime(folder.updatedAt)}
                        </td>
                        <td data-label="操作">
                          <div className="row-menu-wrap" data-menu-root="true">
                            <button
                              aria-label={`“${folder.name}”文件夹操作`}
                              className="icon-button subtle content-row-menu-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleContentRowMenu(
                                  "folder",
                                  folder.id,
                                  event.currentTarget,
                                  "list",
                                  getContentRowMenuItemCount(),
                                );
                              }}
                              title="文件夹操作"
                              type="button"
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </button>
                            {renderContentRowContextMenu(
                              {
                                kind: "folder",
                                folder,
                              },
                              "list",
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visibleFiles.map((file) => (
                      <Fragment key={file.id}>
                        <tr
                          className="content-drive-row content-file-row"
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
                            {formatRelativeTime(file.updatedAt)}
                          </td>
                          <td data-label="操作">
                            <div
                              className="row-menu-wrap"
                              data-menu-root="true"
                            >
                              <button
                                aria-label={`“${file.title}”文档操作`}
                                className="icon-button subtle content-row-menu-button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleContentRowMenu(
                                    "file",
                                    file.id,
                                    event.currentTarget,
                                    "list",
                                    getContentRowMenuItemCount(),
                                  );
                                }}
                                title="文档操作"
                                type="button"
                              >
                                <MoreHorizontal aria-hidden="true" />
                              </button>
                              {renderContentRowContextMenu(
                                { kind: "file", file },
                                "list",
                              )}
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                    {visibleAssets.map((asset) => (
                      <tr
                        className="content-drive-row content-asset-row"
                        key={asset.id}
                        onClick={(event) => onAssetRowClick(event, asset)}
                      >
                        <td data-label="文件名">
                          <a
                            className="content-file-link"
                            href={apiResourceUrl(`/assets/${asset.id}`)}
                            onClick={(event) => {
                              event.preventDefault();
                              setPreviewAsset(asset);
                            }}
                          >
                            <FileIcon aria-hidden="true" />
                            {asset.filename}
                            <small className="muted">
                              {formatFileSize(asset.sizeBytes)}
                            </small>
                          </a>
                        </td>
                        <td data-label="最近更新">
                          {formatRelativeTime(asset.updatedAt)}
                        </td>
                        <td data-label="操作">
                          <div className="content-asset-actions">
                            {asset.canManage ? (
                              <div
                                className="row-menu-wrap"
                                data-menu-root="true"
                              >
                                <button
                                  aria-label={`“${asset.filename}”文件操作`}
                                  className="icon-button subtle content-row-menu-button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleContentRowMenu(
                                      "asset",
                                      asset.id,
                                      event.currentTarget,
                                      "list",
                                      3,
                                    );
                                  }}
                                  title="文件操作"
                                  type="button"
                                >
                                  <MoreHorizontal aria-hidden="true" />
                                </button>
                                {renderAssetContextMenu(asset)}
                              </div>
                            ) : (
                              <a
                                aria-label={`下载“${asset.filename}”`}
                                className="icon-button subtle"
                                href={assetDownloadUrl(asset.id)}
                                title="下载"
                              >
                                <Download aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!loadingItems && !hasVisibleContentItems ? (
                      <tr className="content-empty-row">
                        <td className="empty-cell" colSpan={3}>
                          {renderContentEmptyState()}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="content-drive-grid">
                {loadingItems ? <SkeletonRows count={6} /> : null}
                {visiblePinnedItems.map((item) =>
                  renderContentGridCard(item, pinnedItems.indexOf(item)),
                )}
                {visibleChildFolders.map((folder) =>
                  renderContentGridCard({ kind: "folder", folder }),
                )}
                {visibleFiles.map((file) =>
                  renderContentGridCard({ kind: "file", file }),
                )}
                {visibleAssets.map(renderAssetGridCard)}
                {!loadingItems && !hasVisibleContentItems
                  ? renderContentEmptyState()
                  : null}
              </div>
            )}
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
                className={`permission-inheritance-summary ${grants.length > 0 ? "has-overrides" : ""}`}
              >
                <strong>
                  {grants.length > 0
                    ? "包含例外权限"
                    : permissionTarget?.isRoot
                      ? "沿用文档默认权限"
                      : "沿用上级权限"}
                </strong>
                <span>
                  {grants.length > 0
                    ? `当前${permissionTarget?.type === "file" ? "文档" : "文件夹"}为 ${grants.length} 位成员单独设置；其他成员继续沿用上级权限。`
                    : permissionTarget?.isRoot
                      ? "当前顶层文件夹没有单独设置，成员默认可查看，管理员默认可编辑。"
                      : `当前${permissionTarget?.type === "file" ? "文档" : "文件夹"}没有单独设置，权限会随上级文件夹自动变化。`}
                </span>
              </div>
              <div className="panel-title-row">
                <h2>
                  <Users aria-hidden="true" className="heading-icon" />
                  当前项目的例外
                </h2>
                <span className="badge">{grants.length} 项</span>
              </div>
              {canManageGrants ? (
                <form
                  className="permission-add-row"
                  onSubmit={onGrantPermission}
                >
                  <PermissionUserPicker
                    excludedUserIds={directGrantUserIds}
                    onChange={setGrantUserId}
                    selectedUserId={grantUserId}
                    tags={permissionTags}
                    users={permissionUsers}
                  />
                  <div className="permission-add-actions">
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
                      disabled={!grantUserId}
                      type="submit"
                    >
                      添加例外
                    </button>
                  </div>
                </form>
              ) : (
                <p className="muted">你没有调整这个文件夹权限的权限。</p>
              )}
              <div className="grant-list">
                {grants.map((grant) => (
                  <div className="grant-row" key={grant.id}>
                    <span
                      className="grant-member"
                      title={`@${grant.user.username}`}
                    >
                      <strong>{grant.user.displayName}</strong>
                      <small>
                        @{grant.user.username} · 当前项目单独设置
                        {inheritedFallbackByUserId.get(grant.userId)
                          ? `，恢复后为${permissionLabel(inheritedFallbackByUserId.get(grant.userId)?.level)}（来自「${inheritedFallbackByUserId.get(grant.userId)?.inheritedFrom.targetName}」）`
                          : "，恢复后使用默认权限"}
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
                {grants.length === 0 ? (
                  <div className="empty-panel compact">
                    <strong>没有例外权限</strong>
                    <span>
                      {permissionTarget?.isRoot
                        ? "成员默认可查看，管理员默认可编辑。"
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
                          <strong>{grant.user.displayName}</strong>
                          <small>
                            @{grant.user.username} · 来自「
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

      <AssetPreviewDialog
        asset={previewAsset}
        onClose={() => setPreviewAsset(null)}
      />
      <UploadTaskToast
        onCancel={cancelUpload}
        onDismiss={dismissUpload}
        tasks={uploadTasks}
      />

      {folderBeingRenamed ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="rename-folder-title"
            className="modal-panel content-operation-dialog"
            onSubmit={onRenameFolder}
          >
            <div className="modal-head">
              <h2 id="rename-folder-title">重命名文件夹</h2>
              <button
                aria-label="关闭重命名文件夹"
                className="icon-button subtle"
                onClick={() => {
                  setEditingFolderId(null);
                  setFolderRename("");
                }}
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
                  maxLength={120}
                  onChange={(event) => setFolderRename(event.target.value)}
                  value={folderRename}
                />
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => {
                    setEditingFolderId(null);
                    setFolderRename("");
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={
                    normalizeResourceName(folderRename) ===
                    folderBeingRenamed.name
                  }
                  type="submit"
                >
                  保存名称
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {fileBeingRenamed ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="rename-document-title"
            className="modal-panel content-operation-dialog"
            onSubmit={(event) => void onRenameFile(event, fileBeingRenamed)}
          >
            <div className="modal-head">
              <h2 id="rename-document-title">重命名文档</h2>
              <button
                aria-label="关闭重命名文档"
                className="icon-button subtle"
                onClick={() => {
                  setRenamingFileId(null);
                  setFileRename("");
                }}
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
                  maxLength={120}
                  onChange={(event) => setFileRename(event.target.value)}
                  value={fileRename}
                />
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
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
                <button
                  className="button"
                  disabled={
                    normalizeResourceName(fileRename) === fileBeingRenamed.title
                  }
                  type="submit"
                >
                  保存名称
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {folderBeingMoved ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="move-folder-title"
            className="modal-panel content-operation-dialog"
            onSubmit={(event) => void onMoveFolder(event, folderBeingMoved)}
          >
            <div className="modal-head">
              <h2 id="move-folder-title">移动“{folderBeingMoved.name}”</h2>
              <button
                aria-label="关闭移动文件夹"
                className="icon-button subtle"
                onClick={() => {
                  setMovingFolderId(null);
                  setFolderMoveTargetId("");
                }}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body content-move-dialog-body">
              <p className="content-current-location">
                当前位置：
                {folderBeingMoved.parentId
                  ? folderPathLabel(folderBeingMoved.parentId)
                  : "顶层"}
              </p>
              <fieldset className="content-location-picker">
                <legend>选择目标位置</legend>
                <label>
                  <input
                    checked={folderMoveTargetId === ""}
                    name="folder-move-target"
                    onChange={() => setFolderMoveTargetId("")}
                    type="radio"
                  />
                  <span>顶层</span>
                </label>
                {flatFolders
                  .filter((candidate) => {
                    const blockedIds = getFolderDescendantIds(
                      folderBeingMoved.id,
                    );
                    return (
                      candidate.id !== folderBeingMoved.id &&
                      !blockedIds.has(candidate.id)
                    );
                  })
                  .map((candidate) => (
                    <label key={candidate.id}>
                      <input
                        checked={folderMoveTargetId === candidate.id}
                        name="folder-move-target"
                        onChange={() => setFolderMoveTargetId(candidate.id)}
                        type="radio"
                      />
                      <span>{folderPathLabel(candidate.id)}</span>
                    </label>
                  ))}
              </fieldset>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => {
                    setMovingFolderId(null);
                    setFolderMoveTargetId("");
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={
                    folderMoveTargetId === (folderBeingMoved.parentId ?? "")
                  }
                  type="submit"
                >
                  移动到这里
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {fileBeingMoved ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="move-document-title"
            className="modal-panel content-operation-dialog"
            onSubmit={(event) => void onMoveFile(event, fileBeingMoved)}
          >
            <div className="modal-head">
              <h2 id="move-document-title">移动“{fileBeingMoved.title}”</h2>
              <button
                aria-label="关闭移动文档"
                className="icon-button subtle"
                onClick={() => {
                  setMovingFileId(null);
                  setMoveTargetFolderId("");
                }}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body content-move-dialog-body">
              <p className="content-current-location">
                当前位置：{folderPathLabel(fileBeingMoved.folderId)}
              </p>
              <fieldset className="content-location-picker">
                <legend>选择目标文件夹</legend>
                {flatFolders.map((folder) => (
                  <label key={folder.id}>
                    <input
                      checked={moveTargetFolderId === folder.id}
                      name="document-move-target"
                      onChange={() => setMoveTargetFolderId(folder.id)}
                      type="radio"
                    />
                    <span>{folderPathLabel(folder.id)}</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => {
                    setMovingFileId(null);
                    setMoveTargetFolderId("");
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={moveTargetFolderId === fileBeingMoved.folderId}
                  type="submit"
                >
                  移动到这里
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {renamingAsset ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="rename-asset-title"
            className="modal-panel"
            onSubmit={(event) => void onRenameAssetSubmit(event)}
          >
            <div className="modal-head">
              <h2 id="rename-asset-title">重命名文件</h2>
              <button
                className="icon-button subtle"
                onClick={() => {
                  setRenamingAsset(null);
                  setAssetRename("");
                }}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <label className="label">
                文件名称
                <input
                  autoFocus
                  className="input"
                  maxLength={120}
                  onChange={(event) => setAssetRename(event.target.value)}
                  value={assetRename}
                />
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => {
                    setRenamingAsset(null);
                    setAssetRename("");
                  }}
                  type="button"
                >
                  取消
                </button>
                <button className="button" type="submit">
                  保存名称
                </button>
              </div>
            </div>
          </form>
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
                  maxLength={120}
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

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
