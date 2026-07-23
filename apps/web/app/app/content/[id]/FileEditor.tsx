"use client";

import {
  type CSSProperties,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ContentBlockType,
  PermissionLevel,
  PermissionGroupSummary,
} from "@liveboard/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload,
  GripVertical,
  Image,
  MoreHorizontal,
  Plus,
  RotateCcw,
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
  downloadMarkdown,
  FileDetail,
  getFile,
  listAssignablePermissionGroups,
  listLibraryAssets,
  listPermissionGrants,
  listBlocks,
  FileAssetSummary,
  InheritedPermissionGrantSummary,
  PermissionGrantSummary,
  publishFile,
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
  getTableRows,
  RenderBlockContent,
} from "./ContentBlockRenderer";
import { assetTypeLabel, permissionLabel } from "@/lib/labels";
import { APP_ROUTES } from "@/lib/routes";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { AutoTextarea } from "@/components/AutoTextarea";

const blockShortcuts: Array<{ command: string; type: ContentBlockType }> = [
  { command: "/h1", type: "heading_1" },
  { command: "/h2", type: "heading_2" },
  { command: "/h3", type: "heading_3" },
  { command: "/h4", type: "heading_4" },
  { command: "/h5", type: "heading_5" },
  { command: "/h6", type: "heading_6" },
  { command: "/p", type: "paragraph" },
  { command: "/quote", type: "quote" },
  { command: "/code", type: "code" },
  { command: "/todo", type: "todo" },
  { command: "/ul", type: "bulleted_list" },
  { command: "/ol", type: "numbered_list" },
  { command: "/table", type: "table" },
  { command: "/math", type: "math" },
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

  if (/^heading_[1-6]$/.test(type)) {
    return 1;
  }

  if (["quote", "question"].includes(type)) {
    return 3;
  }

  return 2;
}

export function RichTextBlockEditor({
  block,
  onChange,
  onSave,
}: {
  block: ContentBlock;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const text = getBlockText(block);

  function wrapSelection(before: string, after = before, fallback = "文字") {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = text.slice(start, end) || fallback;
    const next = `${text.slice(0, start)}${before}${selection}${after}${text.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selection.length,
      );
    });
  }

  function insertLink() {
    const href = window.prompt(
      "输入链接地址（http、https、mailto 或站内 / 路径）",
      "https://",
    );
    if (!href) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = text.slice(start, end) || "链接文字";
    const next = `${text.slice(0, start)}[${selection}](${href})${text.slice(end)}`;
    onChange(next);
  }

  return (
    <div className="rich-text-editor">
      <div className="inline-format-toolbar" aria-label="富文本格式">
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => wrapSelection("**")}
          type="button"
        >
          <strong>B</strong>
          <span>加粗</span>
        </button>
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => wrapSelection("*")}
          type="button"
        >
          <em>I</em>
          <span>斜体</span>
        </button>
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => wrapSelection("~~")}
          type="button"
        >
          <del>S</del>
          <span>删除线</span>
        </button>
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => wrapSelection("`")}
          type="button"
        >
          <code>&lt;/&gt;</code>
          <span>行内代码</span>
        </button>
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertLink}
          type="button"
        >
          ↗<span>链接</span>
        </button>
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => wrapSelection("$", "$", "x^2")}
          type="button"
        >
          ∑<span>行内公式</span>
        </button>
      </div>
      <AutoTextarea
        className={`doc-block-input ${block.type}`}
        onBlur={onSave}
        onChange={(event) => onChange(event.target.value)}
        placeholder={getBlockLabel(block.type)}
        ref={textareaRef}
        rows={getBlockRows(block.type)}
        value={text}
      />
    </div>
  );
}

export function TableBlockEditor({
  block,
  onChange,
  onSave,
}: {
  block: ContentBlock;
  onChange: (rows: string[][]) => void;
  onSave: () => void;
}) {
  const rows = getTableRows(block);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const normalized = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? ""),
  );

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    onChange(
      normalized.map((row, index) =>
        index === rowIndex
          ? row.map((cell, cellIndex) =>
              cellIndex === columnIndex ? value : cell,
            )
          : row,
      ),
    );
  }

  return (
    <div
      className="table-block-editor"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onSave();
      }}
    >
      <div className="table-editor-scroll">
        <table>
          <tbody>
            {normalized.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td key={columnIndex}>
                    <input
                      aria-label={`第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`}
                      onChange={(event) =>
                        updateCell(rowIndex, columnIndex, event.target.value)
                      }
                      value={cell}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-editor-actions">
        <span>首行作为表头</span>
        <button
          disabled={normalized.length >= 50}
          onClick={() => onChange([...normalized, Array(columnCount).fill("")])}
          type="button"
        >
          添加行
        </button>
        <button
          disabled={columnCount >= 20}
          onClick={() => onChange(normalized.map((row) => [...row, ""]))}
          type="button"
        >
          添加列
        </button>
        <button
          disabled={normalized.length <= 1}
          onClick={() => onChange(normalized.slice(0, -1))}
          type="button"
        >
          删除末行
        </button>
        <button
          disabled={columnCount <= 1}
          onClick={() => onChange(normalized.map((row) => row.slice(0, -1)))}
          type="button"
        >
          删除末列
        </button>
      </div>
    </div>
  );
}

export function DocumentPreview({
  blocks,
  title,
}: {
  blocks: ContentBlock[];
  title: string;
}) {
  return (
    <article className="editor-preview-document">
      <h1 className="editor-preview-title">{title || "未命名文档"}</h1>
      {blocks.length > 0 ? (
        blocks.map((block) => (
          <div className="editor-preview-block" key={block.id}>
            <RenderBlockContent block={block} />
          </div>
        ))
      ) : (
        <div className="empty-state">添加内容块后，这里会显示最终效果。</div>
      )}
    </article>
  );
}

export function FileEditor({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<FileDetail | null>(null);
  useDocumentTitle(file ? `${file.title} - 编辑` : null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<FileAssetSummary[]>([]);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetTargetBlockId, setAssetTargetBlockId] = useState<string | null>(
    null,
  );
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
  const [inheritedGrants, setInheritedGrants] = useState<
    InheritedPermissionGrantSummary[]
  >([]);
  const [canManageGrants, setCanManageGrants] = useState(false);
  const [grantGroupId, setGrantGroupId] = useState("");
  const [grantLevel, setGrantLevel] = useState<PermissionLevel>("viewer");
  const [showPermissions, setShowPermissions] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "saved" | "dirty" | "saving" | "error"
  >("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
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
  const outlineBlocks = useMemo(
    () =>
      blocks
        .filter((block) => /^heading_[1-6]$/.test(block.type))
        .map((block) => ({
          id: block.id,
          level: Number(block.type.slice(-1)),
          text: getBlockText(block) || "未命名标题",
        })),
    [blocks],
  );

  async function load() {
    const [fileResult, blockResult, grantResult, libraryResult] =
      await Promise.all([
        getFile(fileId),
        listBlocks(fileId),
        listPermissionGrants("file", fileId),
        listLibraryAssets(),
      ]);

    setFile(fileResult.file);
    setBlocks(blockResult.blocks);
    setLibraryAssets(libraryResult.assets);
    setGrants(grantResult.grants);
    setInheritedGrants(grantResult.inheritedGrants);
    setTitleInput(fileResult.file.title);
    setSaveState("saved");
    setLastSavedAt(new Date());
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
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (saveState === "dirty" || saveState === "saving") {
        event.preventDefault();
      }
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [saveState]);

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

  function openAssetPicker(blockId: string) {
    setAssetTargetBlockId(blockId);
    setAssetQuery("");
    setShowAssetModal(true);
  }

  function closeAssetPicker() {
    setShowAssetModal(false);
    setAssetTargetBlockId(null);
  }

  function buildAssetBlockData(asset: FileAssetSummary) {
    const isImage = asset.mimeType.startsWith("image/");

    return {
      text: asset.filename,
      url: asset.url,
      assetId: asset.id,
      filename: asset.filename,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      widthPercent: isImage ? 100 : undefined,
    };
  }

  async function insertAssetIntoTarget(asset: FileAssetSummary) {
    if (!assetTargetBlockId) {
      throw new Error("请选择要插入文件的插图段落");
    }

    const type: ContentBlockType = asset.mimeType.startsWith("image/")
      ? "image"
      : "attachment";
    await updateBlock({
      blockId: assetTargetBlockId,
      type,
      dataJson: buildAssetBlockData(asset),
    });
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
      await insertAssetIntoTarget(asset);
      setMessage(
        asset.mimeType.startsWith("image/") ? "图片已插入" : "附件已插入",
      );
      closeAssetPicker();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上传失败");
    } finally {
      setUploadingAsset(false);
    }
  }

  async function onDownloadMarkdown() {
    setError(null);
    setMessage(null);

    try {
      const result = await downloadMarkdown(fileId);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage("Markdown 已下载");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出 Markdown 失败");
    }
  }

  async function onInsertAsset(asset: FileAssetSummary) {
    setError(null);
    setMessage(null);

    try {
      await insertAssetIntoTarget(asset);
      setMessage("网盘文件已插入");
      closeAssetPicker();
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
    setSaveState("dirty");
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
    patchBlockData(block, { text, inlineFormat: "markdown" });
  }

  async function onUpdateBlockType(
    block: ContentBlock,
    type: ContentBlockType,
  ) {
    setError(null);
    setMessage(null);

    const currentData = asBlockData(block.dataJson);
    const nextData = ["divider", "table", "math"].includes(type)
      ? buildBlockData(type, getBlockText(block))
      : {
          ...currentData,
          text:
            typeof currentData.text === "string"
              ? currentData.text
              : getBlockText(block),
          inlineFormat: "markdown",
        };

    setBlocks((current) =>
      current.map((item) =>
        item.id === block.id ? { ...item, type, dataJson: nextData } : item,
      ),
    );

    setSaveState("saving");
    try {
      await updateBlock({
        blockId: block.id,
        type,
        dataJson: nextData,
      });
      setMessage("内容块类型已更新");
      setSaveState("saved");
      setLastSavedAt(new Date());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新内容块类型失败");
      setSaveState("error");
      await load();
    }
  }

  async function onSaveBlock(block: ContentBlock) {
    setError(null);
    setMessage(null);

    setSaveState("saving");
    try {
      await updateBlock({
        blockId: block.id,
        type: block.type,
        dataJson: block.dataJson,
      });
      setMessage("内容块已保存");
      setSaveState("saved");
      setLastSavedAt(new Date());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存内容块失败");
      setSaveState("error");
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

    setSaveState("saving");
    try {
      await updateFile({
        fileId,
        title: titleInput,
      });
      setMessage("文件已重命名");
      setSaveState("saved");
      setLastSavedAt(new Date());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重命名文件失败");
      setSaveState("error");
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
      setInheritedGrants(grantResult.inheritedGrants);
      setMessage("文件权限已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存文件权限失败");
    }
  }

  async function onDeleteGrant(grantId: string) {
    setError(null);
    setMessage(null);

    try {
      await deletePermissionGrant(grantId);
      const grantResult = await listPermissionGrants("file", fileId);
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
      setMessage("文件已恢复继承上级权限");
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
      setInheritedGrants(grantResult.inheritedGrants);
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
            <button
              className="media-picker-trigger"
              onClick={() => openAssetPicker(block.id)}
              type="button"
            >
              <Image aria-hidden="true" />
              <span>
                <strong>选择图片或附件</strong>
                <small>从电脑上传，或从网盘选择</small>
              </span>
            </button>
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
            {url ? (
              <button
                className="button secondary media-replace-button"
                onClick={() => openAssetPicker(block.id)}
                type="button"
              >
                更换图片或附件
              </button>
            ) : null}
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
            <button
              className="media-picker-trigger"
              onClick={() => openAssetPicker(block.id)}
              type="button"
            >
              <Image aria-hidden="true" />
              <span>
                <strong>选择图片或附件</strong>
                <small>从电脑上传，或从网盘选择</small>
              </span>
            </button>
          )}
          <div className="media-block-fields attachment-fields">
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
            {url ? (
              <button
                className="button secondary media-replace-button"
                onClick={() => openAssetPicker(block.id)}
                type="button"
              >
                更换图片或附件
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    if (block.type === "table") {
      return (
        <TableBlockEditor
          block={block}
          onChange={(rows) => patchBlockData(block, { rows, hasHeader: true })}
          onSave={() => void onSaveBlock(block)}
        />
      );
    }

    if (block.type === "math") {
      return (
        <AutoTextarea
          className="doc-block-input math"
          onBlur={() => void onSaveBlock(block)}
          onChange={(event) =>
            patchBlockData(block, { text: event.target.value, display: true })
          }
          placeholder="输入 LaTeX 公式，例如 E = mc^2"
          rows={3}
          value={getBlockText(block)}
        />
      );
    }

    if (block.type !== "code") {
      return (
        <RichTextBlockEditor
          block={block}
          onChange={(text) => void onUpdateBlock(block, text)}
          onSave={() => void onSaveBlock(block)}
        />
      );
    }

    return (
      <AutoTextarea
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
      <section className="page-head compact editor-title-bar">
        <div>
          <input
            className="title-input"
            value={titleInput}
            onBlur={() => void onRenameFile()}
            onChange={(event) => {
              setTitleInput(event.target.value);
              setSaveState("dirty");
            }}
            aria-label="文件名"
          />
          <div className="editor-meta-strip" aria-label="文件信息">
            <span>
              <strong>内容</strong>
              {blocks.length} 块
            </span>
            <span>
              <strong>保存</strong>
              {saveState === "saving"
                ? "保存中…"
                : saveState === "dirty"
                  ? "有未保存修改"
                  : saveState === "error"
                    ? "保存失败"
                    : lastSavedAt
                      ? `已保存 ${lastSavedAt.toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "已保存"}
            </span>
          </div>
        </div>
        <div className="button-row">
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
            <summary
              className="icon-button subtle row-more-button"
              title="更多文件操作"
            >
              <MoreHorizontal aria-hidden="true" />
            </summary>
            <div className="context-menu">
              <button
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  void onDownloadMarkdown();
                }}
                type="button"
              >
                <Upload aria-hidden="true" />
                导出 Markdown
              </button>
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
        <div className="editor-split">
          <section
            className="editor-pane editor-format-pane"
            aria-label="格式编辑"
          >
            <header className="editor-pane-head">
              <strong>格式编辑</strong>
              <span>选择区块类型并编辑内容</span>
            </header>
            {outlineBlocks.length > 0 ? (
              <nav className="editor-outline" aria-label="文档大纲">
                <strong>大纲</strong>
                <div>
                  {outlineBlocks.map((heading) => (
                    <button
                      key={heading.id}
                      onClick={() => {
                        document
                          .getElementById(`block-${heading.id}`)
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                      }}
                      style={
                        { "--heading-level": heading.level } as CSSProperties
                      }
                      title={heading.text}
                      type="button"
                    >
                      {heading.text}
                    </button>
                  ))}
                </div>
              </nav>
            ) : null}
            <div className="editor-document-shell">
              <div className="document-editor">
                {blocks.map((block) => (
                  <article
                    className={`doc-block ${draggingBlockId === block.id ? "dragging" : ""} ${
                      dragOverBlockId === block.id &&
                      draggingBlockId !== block.id
                        ? "drop-target"
                        : ""
                    }`}
                    id={`block-${block.id}`}
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
                        className="icon-button subtle row-more-button"
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
                    {blockTypeOptions
                      .filter((option) => option.value !== "attachment")
                      .map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                  {["divider", "table", "image"].includes(newType) ? null : (
                    <AutoTextarea
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
                      placeholder="输入新内容，试试 /h1…/h6 /table /math /code /quote /todo /hr"
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
          <aside
            className="editor-pane editor-preview-pane"
            aria-label="格式预览"
          >
            <header className="editor-pane-head">
              <strong>格式预览</strong>
              <span>内容修改会在这里即时呈现</span>
            </header>
            <div className="editor-preview-scroll">
              <DocumentPreview blocks={blocks} title={titleInput} />
            </div>
          </aside>
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
                <h2>插入插图</h2>
                <p className="muted">上传图片或附件，或从网盘选择已有文件。</p>
              </div>
              <button
                className="icon-button subtle"
                onClick={closeAssetPicker}
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
                  <span className="badge">{libraryAssets.length} 个文件</span>
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
                    <p className="muted">没有匹配的文件。</p>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
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
              <div
                className={`permission-inheritance-summary ${groupGrants.length > 0 ? "has-overrides" : ""}`}
              >
                <strong>
                  {groupGrants.length > 0 ? "包含例外权限" : "沿用文件夹权限"}
                </strong>
                <span>
                  {groupGrants.length > 0
                    ? `当前文件为 ${groupGrants.length} 个权限组单独设置；其他权限继续从所在文件夹继承。`
                    : "当前文件没有单独设置，权限会随所在文件夹自动变化。"}
                </span>
              </div>
              <div className="panel-title-row">
                <h2>
                  <Users aria-hidden="true" className="heading-icon" />
                  当前文件的例外
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
                      <small>
                        {grant.group?.memberCount ?? 0} 人 · 当前文件单独设置
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
                        title="恢复继承"
                        type="button"
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
                      全部权限都沿用所在文件夹；通常无需单独设置文件。
                    </span>
                  </div>
                ) : null}
              </div>
              {visibleInheritedGrants.length > 0 ? (
                <section className="permission-inherited-section">
                  <div className="panel-title-row">
                    <h2>从上级继承</h2>
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
    </div>
  );
}
