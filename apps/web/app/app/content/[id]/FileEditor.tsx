"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  ContentBlockType,
  FileSummary,
  PermissionLevel,
  PermissionGroupSummary,
} from "@liveboard/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  GripVertical,
  Image,
  Link2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  ContentBlock,
  createBlock,
  deletePermissionGrant,
  deleteBlock,
  deleteFile,
  FileDetail,
  getFile,
  listAssignablePermissionGroups,
  listLibraryAssets,
  listPermissionGrants,
  listBlocks,
  listFiles,
  FileAssetSummary,
  PermissionGrantSummary,
  publishFile,
  referenceBlocks,
  reorderBlocks,
  updateFile,
  updateBlock,
  uploadAsset,
  upsertPermissionGrant,
} from "@/lib/api";
import {
  asBlockData,
  blockTypeOptions,
  buildBlockData,
  getBlockDataString,
  getBlockLabel,
  getBlockText,
} from "./ContentBlockRenderer";
import {
  assetTypeLabel,
  fileStatusLabel,
  fileTypeLabel,
  permissionLabel,
} from "@/lib/labels";
import { APP_ROUTES, contentPresentation } from "@/lib/routes";

const blockShortcuts: Array<{ command: string; type: ContentBlockType }> = [
  { command: "/h1", type: "heading_1" },
  { command: "/h2", type: "heading_2" },
  { command: "/h3", type: "heading_3" },
  { command: "/p", type: "paragraph" },
  { command: "/quote", type: "quote" },
  { command: "/code", type: "code" },
  { command: "/todo", type: "todo" },
  { command: "/ul", type: "bulleted_list" },
  { command: "/ol", type: "numbered_list" },
];

function getImageWidth(block: ContentBlock) {
  const value = asBlockData(block.dataJson).widthPercent;

  return typeof value === "number" ? Math.max(25, Math.min(100, value)) : 100;
}

function getFilename(block: ContentBlock) {
  return getBlockDataString(block, "filename") || getBlockText(block);
}

function getBlockRows(type: ContentBlockType) {
  if (type === "code") {
    return 4;
  }

  if (["heading_1", "heading_2", "heading_3"].includes(type)) {
    return 1;
  }

  if (["quote", "reference", "question"].includes(type)) {
    return 3;
  }

  return 2;
}

export function FileEditor({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<FileDetail | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [sourceFiles, setSourceFiles] = useState<FileSummary[]>([]);
  const [selectedSourceFileId, setSelectedSourceFileId] = useState("");
  const [sourceBlocks, setSourceBlocks] = useState<ContentBlock[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<FileAssetSummary[]>([]);
  const [assetQuery, setAssetQuery] = useState("");
  const [selectedSourceBlockIds, setSelectedSourceBlockIds] = useState<
    string[]
  >([]);
  const [newType, setNewType] = useState<ContentBlockType>("paragraph");
  const [newText, setNewText] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [openBlockMenu, setOpenBlockMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [groups, setGroups] = useState<PermissionGroupSummary[]>([]);
  const [grants, setGrants] = useState<PermissionGrantSummary[]>([]);
  const [canManageGrants, setCanManageGrants] = useState(false);
  const [grantGroupId, setGrantGroupId] = useState("");
  const [grantLevel, setGrantLevel] = useState<PermissionLevel>("viewer");
  const [showPermissions, setShowPermissions] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showReferenceModal, setShowReferenceModal] = useState(false);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const menuBlock = openBlockMenu
    ? blocks.find((block) => block.id === openBlockMenu.id)
    : null;
  const isPublished = file?.status === "published";
  const isArchived = file?.status === "archived";
  const filteredLibraryAssets = useMemo(
    () =>
      libraryAssets.filter((asset) =>
        assetQuery.trim()
          ? `${asset.filename} ${assetTypeLabel(asset.mimeType, asset.filename)}`
              .toLowerCase()
              .includes(assetQuery.trim().toLowerCase())
          : true,
      ),
    [assetQuery, libraryAssets],
  );

  async function load() {
    const [
      fileResult,
      blockResult,
      fileListResult,
      grantResult,
      libraryResult,
    ] = await Promise.all([
      getFile(fileId),
      listBlocks(fileId),
      listFiles(),
      listPermissionGrants("file", fileId),
      listLibraryAssets(),
    ]);
    const nextSourceFiles = fileListResult.files.filter(
      (item) => item.id !== fileId,
    );

    setFile(fileResult.file);
    setBlocks(blockResult.blocks);
    setSourceFiles(nextSourceFiles);
    setLibraryAssets(libraryResult.assets);
    setSelectedSourceFileId((current) =>
      nextSourceFiles.some((item) => item.id === current)
        ? current
        : nextSourceFiles[0]?.id || "",
    );
    setGrants(grantResult.grants);
    setTitleInput(fileResult.file.title);
    await loadAssignableGroups();
  }

  async function loadAssignableGroups() {
    try {
      const groupResult = await listAssignablePermissionGroups({
        targetType: "file",
        targetId: fileId,
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

  useEffect(() => {
    load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载文件失败");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("[data-menu-root='true']")
      ) {
        return;
      }

      setOpenBlockMenu(null);
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

  useEffect(() => {
    if (!selectedSourceFileId) {
      setSourceBlocks([]);
      setSelectedSourceBlockIds([]);
      return;
    }

    let active = true;

    listBlocks(selectedSourceFileId)
      .then((result) => {
        if (active) {
          setSourceBlocks(result.blocks);
          setSelectedSourceBlockIds([]);
        }
      })
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : "加载来源内容失败",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [selectedSourceFileId]);

  async function onAddBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await createBlock({
        fileId,
        type: newType,
        dataJson: buildBlockData(newType, newText),
      });
      setNewText("");
      setMessage("内容块已添加");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "添加内容块失败");
    }
  }

  function onNewTextChange(value: string) {
    const shortcut = blockShortcuts.find((item) =>
      value.startsWith(`${item.command} `),
    );

    if (shortcut) {
      setNewType(shortcut.type);
      setNewText(value.slice(shortcut.command.length + 1));
      return;
    }

    if (value === "/hr") {
      setNewType("divider");
      setNewText("");
      return;
    }

    setNewText(value);
  }

  async function onUploadAsset(file: File | undefined) {
    if (!file) {
      return;
    }

    setUploadingAsset(true);
    setError(null);
    setMessage(null);

    try {
      const result = await uploadAsset({ file, fileId });
      const asset = result.asset;
      const type: ContentBlockType = asset.mimeType.startsWith("image/")
        ? "image"
        : "attachment";

      await createBlock({
        fileId,
        type,
        dataJson: {
          text: asset.filename,
          url: asset.url,
          assetId: asset.id,
          filename: asset.filename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          widthPercent: type === "image" ? 100 : undefined,
        },
      });
      setMessage(type === "image" ? "图片已上传" : "附件已上传");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上传失败");
    } finally {
      setUploadingAsset(false);
    }
  }

  async function onInsertAsset(asset: FileAssetSummary) {
    setError(null);
    setMessage(null);

    try {
      await createBlock({
        fileId,
        type: asset.mimeType.startsWith("image/") ? "image" : "attachment",
        dataJson: {
          text: asset.filename,
          url: asset.url,
          assetId: asset.id,
          filename: asset.filename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          widthPercent: asset.mimeType.startsWith("image/") ? 100 : undefined,
        },
      });
      setMessage("网盘文件已插入");
      setShowAssetModal(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "插入网盘文件失败");
    }
  }

  async function saveBlockOrder(nextBlocks: ContentBlock[]) {
    setBlocks(nextBlocks);
    setError(null);
    setMessage(null);

    try {
      const result = await reorderBlocks({
        fileId,
        blockIds: nextBlocks.map((block) => block.id),
      });
      setBlocks(result.blocks);
      setMessage("内容顺序已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存顺序失败");
      await load();
    }
  }

  function moveBlock(blockId: string, targetBlockId: string) {
    if (blockId === targetBlockId) {
      return;
    }

    const sourceIndex = blocks.findIndex((block) => block.id === blockId);
    const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);

    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const nextBlocks = [...blocks];
    const [movedBlock] = nextBlocks.splice(sourceIndex, 1);

    if (!movedBlock) {
      return;
    }

    nextBlocks.splice(targetIndex, 0, movedBlock);
    setDragOverBlockId(null);
    void saveBlockOrder(nextBlocks);
  }

  function patchBlockData(block: ContentBlock, patch: Record<string, unknown>) {
    setBlocks((current) =>
      current.map((item) =>
        item.id === block.id
          ? {
              ...item,
              dataJson: { ...asBlockData(item.dataJson), ...patch },
            }
          : item,
      ),
    );
  }

  async function onUpdateBlock(block: ContentBlock, text: string) {
    patchBlockData(block, { text });
  }

  async function onUpdateBlockType(
    block: ContentBlock,
    type: ContentBlockType,
  ) {
    setError(null);
    setMessage(null);

    const currentData = asBlockData(block.dataJson);
    const nextData =
      type === "divider"
        ? {}
        : {
            ...currentData,
            text:
              typeof currentData.text === "string"
                ? currentData.text
                : getBlockText(block),
          };

    setBlocks((current) =>
      current.map((item) =>
        item.id === block.id ? { ...item, type, dataJson: nextData } : item,
      ),
    );

    try {
      await updateBlock({
        blockId: block.id,
        type,
        dataJson: nextData,
      });
      setMessage("内容块类型已更新");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新内容块类型失败");
      await load();
    }
  }

  async function onSaveBlock(block: ContentBlock) {
    setError(null);
    setMessage(null);

    try {
      await updateBlock({
        blockId: block.id,
        type: block.type,
        dataJson: block.dataJson,
      });
      setMessage("内容块已保存");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存内容块失败");
    }
  }

  function toggleBlockMenu(blockId: string, button: HTMLButtonElement) {
    setOpenBlockMenu((current) => {
      if (current?.id === blockId) {
        return null;
      }

      const rect = button.getBoundingClientRect();
      const menuWidth = 176;

      return {
        id: blockId,
        x: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
        y: rect.bottom + 6,
      };
    });
  }

  async function onDeleteBlock(block: ContentBlock) {
    setError(null);
    setMessage(null);

    try {
      await deleteBlock(block.id);
      setMessage("内容块已删除");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除内容块失败");
    }
  }

  async function onPublishFile() {
    setError(null);
    setMessage(null);

    if (isPublished || isArchived) {
      return;
    }

    try {
      await publishFile(fileId);
      setMessage("文件已发布");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发布文件失败");
    }
  }

  async function onDeleteFile() {
    setError(null);
    setMessage(null);

    if (!file || !window.confirm(`确定删除“${file.title}”吗？`)) {
      return;
    }

    try {
      await deleteFile(fileId);
      router.push(APP_ROUTES.content);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除文件失败");
    }
  }

  async function onRenameFile() {
    setError(null);
    setMessage(null);

    if (!titleInput.trim() || titleInput === file?.title) {
      return;
    }

    try {
      await updateFile({
        fileId,
        title: titleInput,
      });
      setMessage("文件已重命名");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重命名文件失败");
    }
  }

  async function onGrantPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!grantGroupId) {
      setError("请选择权限组");
      return;
    }

    try {
      await upsertPermissionGrant({
        targetType: "file",
        targetId: fileId,
        groupId: grantGroupId,
        level: grantLevel,
      });
      const grantResult = await listPermissionGrants("file", fileId);
      setGrants(grantResult.grants);
      setMessage("文件权限已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存文件权限失败");
    }
  }

  function toggleSourceBlock(blockId: string) {
    setSelectedSourceBlockIds((current) =>
      current.includes(blockId)
        ? current.filter((item) => item !== blockId)
        : [...current, blockId],
    );
  }

  async function onReferenceBlocks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (selectedSourceBlockIds.length === 0) {
      setError("请选择要引用的内容块");
      return;
    }

    try {
      await referenceBlocks({
        fileId,
        sourceBlockIds: selectedSourceBlockIds,
      });
      setSelectedSourceBlockIds([]);
      setMessage("引用内容已插入");
      setShowReferenceModal(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "插入引用失败");
    }
  }

  async function onDeleteGrant(grantId: string) {
    setError(null);
    setMessage(null);

    try {
      await deletePermissionGrant(grantId);
      const grantResult = await listPermissionGrants("file", fileId);
      setGrants(grantResult.grants);
      setMessage("文件授权已移除");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移除文件授权失败");
    }
  }

  async function onUpdateGrantLevel(
    grant: PermissionGrantSummary,
    level: PermissionLevel,
  ) {
    setError(null);
    setMessage(null);

    try {
      await upsertPermissionGrant({
        targetType: "file",
        targetId: fileId,
        groupId: grant.groupId ?? "",
        level,
      });
      const grantResult = await listPermissionGrants("file", fileId);
      setGrants(grantResult.grants);
      setMessage("文件权限已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新文件权限失败");
    }
  }

  function renderBlockEditor(block: ContentBlock) {
    if (block.type === "divider") {
      return (
        <button
          className="doc-divider"
          onClick={() => void onSaveBlock(block)}
          type="button"
        />
      );
    }

    if (block.type === "image") {
      const url = getBlockDataString(block, "url");
      const widthPercent = getImageWidth(block);

      return (
        <div className="media-block-editor">
          {url ? (
            <figure className="editable-image-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={getBlockText(block) || "图片"}
                src={url}
                style={{ width: `${widthPercent}%` }}
              />
            </figure>
          ) : (
            <div className="render-placeholder">
              图片：{getBlockText(block) || "等待上传"}
            </div>
          )}
          <div className="media-block-fields">
            <label className="compact-field">
              <span>说明</span>
              <input
                className="input compact-input"
                onBlur={() => void onSaveBlock(block)}
                onChange={(event) =>
                  patchBlockData(block, { text: event.target.value })
                }
                placeholder="图片说明"
                value={getBlockText(block)}
              />
            </label>
            <label className="compact-field range-field">
              <span>宽度 {widthPercent}%</span>
              <input
                max={100}
                min={25}
                onBlur={() => void onSaveBlock(block)}
                onChange={(event) =>
                  patchBlockData(block, {
                    widthPercent: Number(event.target.value),
                  })
                }
                onMouseUp={() => void onSaveBlock(block)}
                onTouchEnd={() => void onSaveBlock(block)}
                step={5}
                type="range"
                value={widthPercent}
              />
            </label>
          </div>
        </div>
      );
    }

    if (block.type === "attachment") {
      const url = getBlockDataString(block, "url");
      const filename = getFilename(block);

      return (
        <div className="media-block-editor">
          {url ? (
            <a
              className="render-attachment editable-attachment"
              href={url}
              rel="noreferrer"
              target="_blank"
            >
              <strong>{filename || "附件"}</strong>
              <span>
                {assetTypeLabel(
                  getBlockDataString(block, "mimeType"),
                  filename,
                )}
              </span>
            </a>
          ) : (
            <div className="render-placeholder">
              附件：{filename || "等待上传"}
            </div>
          )}
          <label className="compact-field">
            <span>标题</span>
            <input
              className="input compact-input"
              onBlur={() => void onSaveBlock(block)}
              onChange={(event) =>
                patchBlockData(block, {
                  filename: event.target.value,
                  text: event.target.value,
                })
              }
              placeholder="附件标题"
              value={filename}
            />
          </label>
        </div>
      );
    }

    return (
      <textarea
        className={
          block.type === "code"
            ? "doc-block-input code"
            : `doc-block-input ${block.type}`
        }
        onChange={(event) => void onUpdateBlock(block, event.target.value)}
        onBlur={() => void onSaveBlock(block)}
        placeholder={getBlockLabel(block.type)}
        rows={getBlockRows(block.type)}
        value={getBlockText(block)}
      />
    );
  }

  return (
    <div className="workspace">
      <section className="page-head compact">
        <div>
          <input
            className="title-input"
            value={titleInput}
            onBlur={() => void onRenameFile()}
            onChange={(event) => setTitleInput(event.target.value)}
            aria-label="文件名"
          />
          <div className="editor-meta-strip" aria-label="文件信息">
            <span>
              <strong>类型</strong>
              {file ? fileTypeLabel(file.type) : "-"}
            </span>
            <span>
              <strong>状态</strong>
              {file ? fileStatusLabel(file.status) : "-"}
            </span>
            <span>
              <strong>权限</strong>
              {permissionLabel(file?.permission)}
            </span>
            <span>
              <strong>内容</strong>
              {blocks.length} 块
            </span>
            <span>
              <strong>保存</strong>
              自动保存
            </span>
          </div>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={contentPresentation(fileId)}>
            <BookOpen aria-hidden="true" className="button-icon" />
            授课模式
          </Link>
          <button
            className="button secondary"
            onClick={() => setShowAssetModal(true)}
            type="button"
          >
            <Paperclip aria-hidden="true" className="button-icon" />
            素材
          </button>
          <button
            className="button secondary"
            onClick={() => setShowReferenceModal(true)}
            type="button"
          >
            <Link2 aria-hidden="true" className="button-icon" />
            引用
          </button>
          {isPublished ? (
            <span className="publish-state-badge">已发布</span>
          ) : isArchived ? (
            <span className="publish-state-badge muted">已归档</span>
          ) : (
            <button
              className="button secondary"
              onClick={onPublishFile}
              type="button"
            >
              <Send aria-hidden="true" className="button-icon" />
              发布
            </button>
          )}
          <details className="editor-more-menu">
            <summary className="icon-button subtle" title="更多文件操作">
              <MoreHorizontal aria-hidden="true" />
            </summary>
            <div className="context-menu">
              <button
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  setShowPermissions(true);
                }}
                type="button"
              >
                <Users aria-hidden="true" />
                权限设置
              </button>
              <button
                className="danger"
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  void onDeleteFile();
                }}
                type="button"
              >
                <Trash2 aria-hidden="true" />
                删除文件
              </button>
            </div>
          </details>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="editor-workspace">
        <div className="editor-document-shell">
          <div className="document-editor">
            {blocks.map((block) => (
              <article
                className={`doc-block ${draggingBlockId === block.id ? "dragging" : ""} ${
                  dragOverBlockId === block.id && draggingBlockId !== block.id
                    ? "drop-target"
                    : ""
                }`}
                key={block.id}
                onDragOver={(event) => event.preventDefault()}
                onDragEnter={() => {
                  if (draggingBlockId && draggingBlockId !== block.id) {
                    setDragOverBlockId(block.id);
                  }
                }}
                onDrop={() => {
                  if (draggingBlockId) {
                    moveBlock(draggingBlockId, block.id);
                    setDraggingBlockId(null);
                  }
                }}
              >
                <div className="doc-block-controls" data-menu-root="true">
                  <span
                    className="drag-handle"
                    draggable
                    onDragEnd={() => {
                      setDraggingBlockId(null);
                      setDragOverBlockId(null);
                    }}
                    onDragStart={() => {
                      setDraggingBlockId(block.id);
                      setDragOverBlockId(null);
                    }}
                    title="拖动排序"
                  >
                    <GripVertical aria-hidden="true" />
                  </span>
                  <button
                    className="icon-button subtle"
                    onClick={(event) =>
                      toggleBlockMenu(block.id, event.currentTarget)
                    }
                    title="内容块操作"
                    type="button"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </button>
                </div>
                <div className="doc-block-body">
                  <div className="doc-block-toolbar">
                    <select
                      className="block-type-select"
                      title="内容块类型"
                      value={block.type}
                      onChange={(event) =>
                        void onUpdateBlockType(
                          block,
                          event.target.value as ContentBlockType,
                        )
                      }
                    >
                      {blockTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {renderBlockEditor(block)}
                </div>
              </article>
            ))}
            {blocks.length === 0 ? (
              <div className="empty-state">这个文件还没有内容块。</div>
            ) : null}
            <form className="doc-add-block" onSubmit={onAddBlock}>
              <select
                className="select"
                value={newType}
                onChange={(event) =>
                  setNewType(event.target.value as ContentBlockType)
                }
              >
                {blockTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {newType === "divider" ? null : (
                <textarea
                  className="doc-new-block-input"
                  onChange={(event) => onNewTextChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter"
                    ) {
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="输入新内容，试试 /h1 /h2 /code /quote /todo /hr"
                  rows={3}
                  value={newText}
                />
              )}
              <button className="button secondary" type="submit">
                <Plus aria-hidden="true" className="button-icon" />
                添加块
              </button>
            </form>
            {openBlockMenu && menuBlock ? (
              <div
                className="context-menu floating-block-menu"
                data-menu-root="true"
                style={{ left: openBlockMenu.x, top: openBlockMenu.y }}
              >
                <button
                  onClick={() => {
                    setOpenBlockMenu(null);
                    void onSaveBlock(menuBlock);
                  }}
                  type="button"
                >
                  保存
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setOpenBlockMenu(null);
                    void onDeleteBlock(menuBlock);
                  }}
                  type="button"
                >
                  删除
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {showAssetModal ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-panel editor-tool-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-head">
              <div>
                <h2>插入素材</h2>
                <p className="muted">上传新附件，或从网盘选择已有文件。</p>
              </div>
              <button
                className="icon-button subtle"
                onClick={() => setShowAssetModal(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body editor-tool-body">
              <label className="upload-dropzone large">
                <input
                  disabled={uploadingAsset}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void onUploadAsset(file);
                  }}
                  type="file"
                />
                <span>
                  <Image aria-hidden="true" />
                  {uploadingAsset ? "上传中" : "选择图片或附件"}
                </span>
              </label>

              <div className="tool-modal-section">
                <div className="panel-title-row">
                  <h3>网盘文件</h3>
                  <span className="badge">{libraryAssets.length} 个素材</span>
                </div>
                <input
                  className="input"
                  onChange={(event) => setAssetQuery(event.target.value)}
                  placeholder="搜索网盘"
                  value={assetQuery}
                />
                <div className="library-picker modal-library-picker">
                  {filteredLibraryAssets.slice(0, 12).map((asset) => (
                    <div className="library-picker-row" key={asset.id}>
                      <span>
                        <b>{asset.filename}</b>
                        <small title={asset.mimeType}>
                          {assetTypeLabel(asset.mimeType, asset.filename)}
                        </small>
                      </span>
                      <button
                        className="table-action"
                        onClick={() => void onInsertAsset(asset)}
                        type="button"
                      >
                        插入
                      </button>
                    </div>
                  ))}
                  {libraryAssets.length === 0 ? (
                    <p className="muted">网盘还没有文件。</p>
                  ) : null}
                  {libraryAssets.length > 0 &&
                  filteredLibraryAssets.length === 0 ? (
                    <p className="muted">没有匹配的素材。</p>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {showReferenceModal ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal-panel editor-tool-modal"
            onSubmit={onReferenceBlocks}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-head">
              <div>
                <h2>引用内容</h2>
                <p className="muted">从其他资料中选择内容块插入当前文件。</p>
              </div>
              <button
                className="icon-button subtle"
                onClick={() => setShowReferenceModal(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body editor-tool-body">
              <label className="form-field">
                <span>来源文件</span>
                <select
                  className="select"
                  disabled={sourceFiles.length === 0}
                  value={selectedSourceFileId}
                  onChange={(event) =>
                    setSelectedSourceFileId(event.target.value)
                  }
                >
                  {sourceFiles.map((sourceFile) => (
                    <option key={sourceFile.id} value={sourceFile.id}>
                      {sourceFile.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="reference-picker modal-reference-picker">
                {sourceBlocks.map((sourceBlock) => {
                  const sourceText = getBlockText(sourceBlock);
                  const sourceTitle = getBlockDataString(
                    sourceBlock,
                    "sourceFileTitle",
                  );

                  return (
                    <label className="reference-option" key={sourceBlock.id}>
                      <input
                        checked={selectedSourceBlockIds.includes(
                          sourceBlock.id,
                        )}
                        onChange={() => toggleSourceBlock(sourceBlock.id)}
                        type="checkbox"
                      />
                      <span>
                        <b>{getBlockLabel(sourceBlock.type)}</b>
                        <small>
                          {sourceText ||
                            sourceTitle ||
                            "这个内容块没有文字预览"}
                        </small>
                      </span>
                    </label>
                  );
                })}
                {sourceFiles.length === 0 ? (
                  <p className="muted">暂无其他可引用文件。</p>
                ) : null}
                {sourceFiles.length > 0 && sourceBlocks.length === 0 ? (
                  <p className="muted">这个来源文件还没有内容块。</p>
                ) : null}
              </div>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setShowReferenceModal(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="button" type="submit">
                  插入引用
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {showPermissions ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-panel permission-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-head">
              <div>
                <h2>文件权限</h2>
                <p className="muted">{file?.title ?? "当前文件"}</p>
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
                <p className="muted">你没有调整这个文件权限的权限。</p>
              )}
              <div className="grant-list">
                {groupGrants.map((grant) => (
                  <div className="grant-row" key={grant.id}>
                    <span
                      className="grant-member"
                      title={grant.group?.name ?? "权限组"}
                    >
                      <strong>{grant.group?.name ?? "权限组"}</strong>
                      <small>{grant.group?.memberCount ?? 0} 个成员</small>
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
                        title="移除授权"
                        type="button"
                      >
                        <X aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
                {groupGrants.length === 0 ? (
                  <div className="empty-panel compact">
                    <strong>没有组授权</strong>
                    <span>此文件会继续使用所在位置继承下来的权限。</span>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
