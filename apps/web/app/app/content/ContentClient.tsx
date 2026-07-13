"use client";

import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ChevronRight,
  X,
  FileText,
  Folder,
  MoreHorizontal,
  MoveRight,
  Presentation,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import type {
  FileSummary,
  FileType,
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
  listAssignablePermissionGroups,
  listFiles,
  listPermissionGrants,
  PermissionGrantSummary,
  updateFile,
  updateFolder,
  upsertPermissionGrant,
} from "@/lib/api";
import {
  fileStatusLabel,
  fileTypeLabel,
  formatDateTime,
  permissionLabel,
} from "@/lib/labels";
import { contentDetail, contentPresentation } from "@/lib/routes";

type FlatFolderNode = FolderNode & { depth: number };
type FloatingMenuState = {
  id: string;
  x: number;
  y: number;
};
type TreeDepthStyle = CSSProperties & {
  "--tree-depth": number;
};
type PermissionTarget = {
  type: "folder" | "file";
  id: string;
  name: string;
};

function flattenFolders(folders: FolderNode[], depth = 0): FlatFolderNode[] {
  return folders.flatMap((folder) => [
    { ...folder, depth },
    ...flattenFolders(folder.children, depth + 1),
  ]);
}

function treeDepthStyle(depth: number): TreeDepthStyle {
  return { "--tree-depth": Math.min(depth, 7) };
}

export function ContentClient() {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [openFolderMenu, setOpenFolderMenu] =
    useState<FloatingMenuState | null>(null);
  const [openFileMenu, setOpenFileMenu] = useState<FloatingMenuState | null>(
    null,
  );
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);
  const [folderMoveTargetId, setFolderMoveTargetId] = useState("");
  const [movingFileId, setMovingFileId] = useState<string | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState("");
  const [showCreateFile, setShowCreateFile] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [permissionTarget, setPermissionTarget] =
    useState<PermissionTarget | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderParentId, setFolderParentId] = useState("");
  const [folderRename, setFolderRename] = useState("");
  const [fileTitle, setFileTitle] = useState("");
  const [fileType, setFileType] = useState<FileType>("doc");
  const [groups, setGroups] = useState<PermissionGroupSummary[]>([]);
  const [grants, setGrants] = useState<PermissionGrantSummary[]>([]);
  const [canManageGrants, setCanManageGrants] = useState(false);
  const [grantGroupId, setGrantGroupId] = useState("");
  const [grantLevel, setGrantLevel] = useState<PermissionLevel>("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);
  const activeFolder = flatFolders.find(
    (folder) => folder.id === activeFolderId,
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

  async function load() {
    const folderResult = await getFolderTree();
    const nextFlatFolders = flattenFolders(folderResult.folders);
    const firstFolder = folderResult.folders[0]?.id ?? null;
    const selectedFolderId =
      activeFolderId &&
      nextFlatFolders.some((folder) => folder.id === activeFolderId)
        ? activeFolderId
        : firstFolder;

    setFolders(folderResult.folders);
    setActiveFolderId(selectedFolderId);

    const fileResult = await listFiles(selectedFolderId ?? undefined);
    setFiles(fileResult.files);

    if (selectedFolderId) {
      const [grantResult] = await Promise.all([
        listPermissionGrants("folder", selectedFolderId),
        loadAssignableGroups(selectedFolderId),
      ]);
      setGrants(grantResult.grants);
    } else {
      setGroups([]);
      setGrantGroupId("");
      setCanManageGrants(false);
    }
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
    setOpenFolderMenu(null);
    setOpenFileMenu(null);
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
    function closeMenus(event: MouseEvent) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("[data-menu-root='true']")
      ) {
        return;
      }

      setOpenFolderMenu(null);
      setOpenFileMenu(null);
    }

    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    if (availableGrantGroups.some((group) => group.id === grantGroupId)) {
      return;
    }

    setGrantGroupId(availableGrantGroups[0]?.id ?? "");
  }, [availableGrantGroups, grantGroupId]);

  async function selectFolder(folderId: string) {
    setActiveFolderId(folderId);
    setError(null);
    const [fileResult, grantResult] = await Promise.all([
      listFiles(folderId),
      listPermissionGrants("folder", folderId),
      loadAssignableGroups(folderId),
    ]);
    setFiles(fileResult.files);
    setGrants(grantResult.grants);
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
        type: fileType,
      });
      setFileTitle("");
      setShowCreateFile(false);
      setMessage("文件已创建");
      await selectFolder(activeFolderId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建文件失败");
    }
  }

  async function onDeleteFile(file: FileSummary) {
    setError(null);
    setMessage(null);

    if (!window.confirm(`确定删除“${file.title}”吗？`)) {
      return;
    }

    try {
      await deleteFile(file.id);
      setMessage("文件已删除");

      if (activeFolderId) {
        const fileResult = await listFiles(activeFolderId);
        setFiles(fileResult.files);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除文件失败");
    }
  }

  function beginMoveFile(file: FileSummary) {
    const fallbackFolder =
      flatFolders.find((folder) => folder.id !== file.folderId)?.id ??
      file.folderId;

    setMovingFileId(file.id);
    setMoveTargetFolderId(fallbackFolder);
    setOpenFileMenu(null);
  }

  function getFloatingMenuPosition(
    button: HTMLButtonElement,
    itemCount: number,
  ) {
    const rect = button.getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = itemCount * 35 + 2;
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

  function toggleFolderMenu(folder: FlatFolderNode, button: HTMLButtonElement) {
    setOpenFileMenu(null);
    setOpenFolderMenu((current) => {
      if (current?.id === folder.id) {
        return null;
      }

      return {
        id: folder.id,
        ...getFloatingMenuPosition(
          button,
          folder.children.length === 0 && folder.fileCount === 0 ? 5 : 4,
        ),
      };
    });
  }

  function toggleFileMenu(fileId: string, button: HTMLButtonElement) {
    setOpenFolderMenu(null);
    setOpenFileMenu((current) => {
      if (current?.id === fileId) {
        return null;
      }

      return {
        id: fileId,
        ...getFloatingMenuPosition(button, 5),
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
    setOpenFolderMenu(null);
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

  function beginMoveFolder(folder: FlatFolderNode) {
    const blockedIds = getFolderDescendantIds(folder.id);
    const fallbackFolder =
      flatFolders.find(
        (candidate) =>
          candidate.id !== folder.id && !blockedIds.has(candidate.id),
      )?.id ?? "";

    setMovingFolderId(folder.id);
    setFolderMoveTargetId(folder.parentId ?? fallbackFolder);
    setOpenFolderMenu(null);
  }

  async function onMoveFolder(
    event: FormEvent<HTMLFormElement>,
    folder: FlatFolderNode,
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
      setMessage("文件已移动");

      if (activeFolderId) {
        const fileResult = await listFiles(activeFolderId);
        setFiles(fileResult.files);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移动文件失败");
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

  async function onDeleteFolder(folderId: string) {
    setError(null);
    setMessage(null);

    if (!window.confirm("确定删除这个空文件夹吗？")) {
      return;
    }

    try {
      await deleteFolder(folderId);
      setOpenFolderMenu(null);
      if (folderId === activeFolderId) {
        setActiveFolderId(null);
      }
      setMessage("文件夹已删除");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "删除文件夹失败，请确认文件夹为空",
      );
    }
  }

  function beginRenameFolder(folder: FlatFolderNode) {
    setEditingFolderId(folder.id);
    setFolderRename(folder.name);
    setOpenFolderMenu(null);
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
      setMessage("授权已移除");
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
      setMessage("权限已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新权限失败");
    }
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">内容工作区</p>
          <h1>内容</h1>
          <p className="muted">
            按文件夹组织教学内容，并管理文件权限与授课入口。
          </p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="workbench files-layout">
        <aside className="folder-panel">
          <div className="panel-head">
            <div>
              <h2>
                <Folder aria-hidden="true" className="heading-icon" />
                位置
              </h2>
            </div>
            <button
              className="icon-button"
              onClick={() =>
                showCreateFolder
                  ? setShowCreateFolder(false)
                  : beginCreateFolder(activeFolderId)
              }
              title="新建文件夹"
              type="button"
            >
              {showCreateFolder ? (
                <X aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="file-tree">
            {flatFolders.map((folder) => (
              <div className="tree-row-wrap" key={folder.id}>
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
                    <button
                      className="button secondary compact-button"
                      type="submit"
                    >
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
                    className={
                      folder.id === activeFolderId
                        ? "tree-item active"
                        : "tree-item"
                    }
                    data-menu-root="true"
                    style={treeDepthStyle(folder.depth)}
                  >
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
                      className="icon-button subtle"
                      onClick={(event) =>
                        toggleFolderMenu(folder, event.currentTarget)
                      }
                      title="文件夹操作"
                      type="button"
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </button>
                    {openFolderMenu?.id === folder.id ? (
                      <div
                        className="context-menu floating-context-menu"
                        style={{
                          left: openFolderMenu.x,
                          top: openFolderMenu.y,
                        }}
                      >
                        <button
                          onClick={() => beginCreateFolder(folder.id)}
                          type="button"
                        >
                          <Plus aria-hidden="true" />
                          新建文件夹
                        </button>
                        <button
                          onClick={() => beginRenameFolder(folder)}
                          type="button"
                        >
                          <Pencil aria-hidden="true" />
                          重命名
                        </button>
                        <button
                          onClick={() => beginMoveFolder(folder)}
                          type="button"
                        >
                          <MoveRight aria-hidden="true" />
                          移动到…
                        </button>
                        <button
                          onClick={() =>
                            void openPermissions({
                              type: "folder",
                              id: folder.id,
                              name: folder.name,
                            })
                          }
                          type="button"
                        >
                          <Users aria-hidden="true" />
                          权限设置
                        </button>
                        {folder.children.length === 0 &&
                        folder.fileCount === 0 ? (
                          <button
                            className="danger"
                            onClick={() => void onDeleteFolder(folder.id)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" />
                            删除空文件夹
                          </button>
                        ) : null}
                      </div>
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
                      onChange={(event) =>
                        setFolderMoveTargetId(event.target.value)
                      }
                    >
                      <option value="">顶层</option>
                      {flatFolders
                        .filter((candidate) => {
                          const blockedIds = getFolderDescendantIds(folder.id);
                          return (
                            candidate.id !== folder.id &&
                            !blockedIds.has(candidate.id)
                          );
                        })
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {"  ".repeat(candidate.depth)}
                            {candidate.name}
                          </option>
                        ))}
                    </select>
                    <button
                      className="button secondary compact-button"
                      type="submit"
                    >
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
            ))}
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
          <div className="panel-head">
            <div>
              <h2>
                <FileText aria-hidden="true" className="heading-icon" />
                内容
              </h2>
              <div className="breadcrumb" aria-label="当前位置">
                {activeFolderPath.map((folder, index) => (
                  <span key={folder.id}>
                    {index > 0 ? <ChevronRight aria-hidden="true" /> : null}
                    <button
                      onClick={() => void selectFolder(folder.id)}
                      type="button"
                    >
                      {folder.name}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="toolbar-row">
              <button
                className="button secondary"
                onClick={() => setShowCreateFile((current) => !current)}
                type="button"
              >
                <Plus aria-hidden="true" className="button-icon" />
                新建文件
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th>文件名</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>最近更新</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <Fragment key={file.id}>
                    <tr>
                      <td data-label="文件名">
                        <Link href={contentDetail(file.id)}>{file.title}</Link>
                      </td>
                      <td data-label="类型">{fileTypeLabel(file.type)}</td>
                      <td data-label="状态">{fileStatusLabel(file.status)}</td>
                      <td data-label="最近更新">
                        {formatDateTime(file.updatedAt)}
                      </td>
                      <td data-label="操作">
                        <div className="row-menu-wrap" data-menu-root="true">
                          <button
                            className="icon-button subtle"
                            onClick={(event) =>
                              toggleFileMenu(file.id, event.currentTarget)
                            }
                            title="文件操作"
                            type="button"
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </button>
                          {openFileMenu?.id === file.id ? (
                            <div
                              className="context-menu floating-context-menu"
                              style={{
                                left: openFileMenu.x,
                                top: openFileMenu.y,
                              }}
                            >
                              <Link href={contentDetail(file.id)}>
                                <FileText aria-hidden="true" />
                                打开
                              </Link>
                              <Link href={contentPresentation(file.id)}>
                                <Presentation aria-hidden="true" />
                                授课模式
                              </Link>
                              <button
                                onClick={() => beginMoveFile(file)}
                                type="button"
                              >
                                <MoveRight aria-hidden="true" />
                                移动到…
                              </button>
                              <button
                                onClick={() =>
                                  void openPermissions({
                                    type: "file",
                                    id: file.id,
                                    name: file.title,
                                  })
                                }
                                type="button"
                              >
                                <Users aria-hidden="true" />
                                权限设置
                              </button>
                              <button
                                onClick={() => {
                                  setOpenFileMenu(null);
                                  void onDeleteFile(file);
                                }}
                                className="danger"
                                type="button"
                              >
                                <Trash2 aria-hidden="true" />
                                删除
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {movingFileId === file.id ? (
                      <tr>
                        <td colSpan={5}>
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
                  </Fragment>
                ))}
                {files.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={5}>
                      <div className="empty-panel">
                        <strong>当前文件夹还没有文件</strong>
                        <span>可以新建文档、教案、课程或练习集。</span>
                        <button
                          className="button secondary"
                          onClick={() => setShowCreateFile(true)}
                          type="button"
                        >
                          <Plus aria-hidden="true" className="button-icon" />
                          新建文件
                        </button>
                      </div>
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
                    ? "文件权限"
                    : "文件夹权限"}
                </h2>
                <p className="muted">{permissionTarget?.name ?? "当前内容"}</p>
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
              <div className="panel-title-row">
                <h2>
                  <Users aria-hidden="true" className="heading-icon" />
                  直接授权
                </h2>
                <span className="badge">{groupGrants.length} 个组授权</span>
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
                    <option value="lecturer">可授课</option>
                    <option value="editor">可编辑</option>
                    <option value="owner">所有者</option>
                    <option value="no_access">无访问权限</option>
                  </select>
                  <button
                    className="button"
                    disabled={
                      !grantGroupId || availableGrantGroups.length === 0
                    }
                    type="submit"
                  >
                    授权
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
                      <small>{grant.group?.memberCount ?? 0} 人</small>
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
                        <option value="lecturer">可授课</option>
                        <option value="editor">可编辑</option>
                        <option value="owner">所有者</option>
                        <option value="no_access">无访问权限</option>
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
                        title="移除授权"
                      >
                        <X aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
                {groupGrants.length === 0 ? (
                  <div className="empty-panel compact">
                    <strong>没有组授权</strong>
                    <span>成员会继续使用上级位置继承下来的权限组。</span>
                  </div>
                ) : null}
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
              <h2>新建文件</h2>
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
                文件名
                <input
                  autoFocus
                  className="input"
                  placeholder="例如：第 1 周授课"
                  value={fileTitle}
                  onChange={(event) => setFileTitle(event.target.value)}
                />
              </label>
              <label className="label">
                文件类型
                <select
                  className="select"
                  value={fileType}
                  onChange={(event) =>
                    setFileType(event.target.value as FileType)
                  }
                >
                  <option value="doc">普通文档</option>
                  <option value="book">书本</option>
                  <option value="lesson">教案</option>
                  <option value="course">课程</option>
                  <option value="exercise_set">练习集</option>
                </select>
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
                  创建文件
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
