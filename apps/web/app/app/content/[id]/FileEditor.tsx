"use client";

import {
  type CSSProperties,
  FormEvent,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ContentBlockType,
  FileSummary,
  FolderNode,
  PermissionLevel,
  UserSummary,
  UserTagSummary,
} from "@liveboard/shared";
import {
  getResourceNameError,
  normalizeResourceName,
} from "@liveboard/shared/resource-name";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  Upload,
  GripVertical,
  Image,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  ContentBlock,
  attachmentDownloadUrl,
  createBlock,
  deletePermissionGrant,
  deleteBlock,
  deleteFile,
  deleteLibraryAsset,
  downloadMarkdown,
  FileDetail,
  getFile,
  getFolderTree,
  listAssignablePermissionUsers,
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
  uploadAssetDirect,
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
import { APP_ROUTES, contentDetail } from "@/lib/routes";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { AutoTextarea } from "@/components/AutoTextarea";
import { compressImageFile } from "@/components/image-compress";
import { PermissionUserPicker } from "@/components/PermissionUserPicker";
import { UploadTaskToast } from "@/components/upload/UploadTaskToast";
import {
  prepareUploadJobs,
  useUploadTask,
} from "@/components/upload/useUploadTask";
import {
  FeedbackNotice,
  useFeedbackNotice,
} from "@/components/system/FeedbackNotice";

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
  { command: "/bilibili", type: "bilibili" },
];

// 添加块的表单：底部追加和块间内联插入共用，各自持有输入状态互不干扰。
function AddBlockForm({
  autoFocus = false,
  className,
  onCancel,
  onSubmit,
  submitLabel = "添加块",
}: {
  autoFocus?: boolean;
  className?: string;
  onCancel?: () => void;
  onSubmit: (type: ContentBlockType, text: string) => Promise<void>;
  submitLabel?: string;
}) {
  const [newType, setNewType] = useState<ContentBlockType>("paragraph");
  const [newText, setNewText] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      await onSubmit(newType, newText);
      setNewText("");
      onCancel?.();
    } catch {
      // 错误提示由父组件统一展示，表单保留输入内容。
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={className} onSubmit={(event) => void handleSubmit(event)}>
      <select
        aria-label="内容块类型"
        className="select"
        value={newType}
        onChange={(event) => setNewType(event.target.value as ContentBlockType)}
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
          autoFocus={autoFocus}
          className="doc-new-block-input"
          onChange={(event) => onNewTextChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.currentTarget.form?.requestSubmit();
            }

            if (event.key === "Escape") {
              onCancel?.();
            }
          }}
          placeholder="输入新内容，试试 /h1…/h6 /table /math /bilibili /code /quote /todo /hr"
          rows={3}
          value={newText}
        />
      )}
      <div className="doc-add-block-actions">
        {onCancel ? (
          <button className="button secondary" onClick={onCancel} type="button">
            取消
          </button>
        ) : null}
        <button
          className="button secondary"
          disabled={submitting}
          type="submit"
        >
          <Plus aria-hidden="true" className="button-icon" />
          {submitting ? "添加中…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

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

export interface InternalDocumentOption {
  id: string;
  title: string;
  path: string;
  status: FileSummary["status"];
}

export function flattenInternalDocuments(
  folders: FolderNode[],
  parentPath = "",
): InternalDocumentOption[] {
  return folders.flatMap((folder) => {
    const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;

    return [
      ...folder.files.map((file) => ({
        id: file.id,
        title: file.title,
        path,
        status: file.status,
      })),
      ...flattenInternalDocuments(folder.children, path),
    ];
  });
}

export function syncScrollProgress(
  source: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  target: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
) {
  const sourceRange = source.scrollHeight - source.clientHeight;
  const targetRange = target.scrollHeight - target.clientHeight;

  if (sourceRange <= 0 || targetRange <= 0) {
    return null;
  }

  const progress = Math.max(0, Math.min(1, source.scrollTop / sourceRange));
  target.scrollTop = progress * targetRange;
  return progress;
}

function setScrollProgress(
  element: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  progress: number,
) {
  const range = element.scrollHeight - element.clientHeight;
  element.scrollTop = Math.max(0, range) * Math.max(0, Math.min(1, progress));
}

export function RichTextBlockEditor({
  block,
  internalDocuments = [],
  onChange,
  onSave,
}: {
  block: ContentBlock;
  internalDocuments?: InternalDocumentOption[];
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const [showDocumentPicker, setShowDocumentPicker] = useState(false);
  const [documentQuery, setDocumentQuery] = useState("");
  const text = getBlockText(block);
  const filteredDocuments = useMemo(() => {
    const query = documentQuery.trim().toLocaleLowerCase("zh-CN");

    return internalDocuments.filter((document) =>
      query
        ? `${document.title} ${document.path}`
            .toLocaleLowerCase("zh-CN")
            .includes(query)
        : true,
    );
  }, [documentQuery, internalDocuments]);

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

  function openDocumentPicker() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    setDocumentQuery("");
    setShowDocumentPicker(true);
  }

  function insertExternalLink() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const href = window.prompt(
      "输入站外链接地址（http、https 或 mailto）",
      "https://",
    );
    if (!href) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = text.slice(start, end) || "链接文字";
    const next = `${text.slice(0, start)}[${selection}](${href})${text.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + selection.length + href.length + 4;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function insertDocumentLink(document: InternalDocumentOption) {
    const { start, end } = selectionRef.current;
    const selection = text.slice(start, end) || document.title;
    const href = contentDetail(document.id);
    const next = `${text.slice(0, start)}[${selection}](${href})${text.slice(end)}`;
    onChange(next);
    setShowDocumentPicker(false);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = start + selection.length + String(href).length + 4;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  useEffect(() => {
    if (!showDocumentPicker) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowDocumentPicker(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showDocumentPicker]);

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
          onClick={insertExternalLink}
          type="button"
        >
          ↗<span>链接</span>
        </button>
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={openDocumentPicker}
          type="button"
        >
          ◫<span>站内文档</span>
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
      {showDocumentPicker && typeof document !== "undefined"
        ? createPortal(
            <div
              className="modal-backdrop internal-document-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setShowDocumentPicker(false);
                }
              }}
              role="presentation"
            >
              <section
                aria-labelledby={`document-link-title-${block.id}`}
                aria-modal="true"
                className="modal-panel internal-document-modal"
                role="dialog"
              >
                <div className="modal-head">
                  <div>
                    <h2 id={`document-link-title-${block.id}`}>
                      链接到站内文档
                    </h2>
                    <p className="muted">
                      选择有权访问的文档，链接将在本站当前页面打开
                    </p>
                  </div>
                  <button
                    aria-label="关闭站内文档选择"
                    className="icon-button subtle"
                    onClick={() => setShowDocumentPicker(false)}
                    type="button"
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
                <div className="modal-body internal-document-body">
                  <label className="internal-document-search">
                    <Search aria-hidden="true" />
                    <input
                      aria-label="搜索站内文档"
                      autoFocus
                      className="input"
                      onChange={(event) => setDocumentQuery(event.target.value)}
                      placeholder="搜索文档名或所在位置"
                      value={documentQuery}
                    />
                  </label>
                  <div className="internal-document-result-meta">
                    <span>
                      {documentQuery.trim()
                        ? `找到 ${filteredDocuments.length} 份文档`
                        : `共 ${internalDocuments.length} 份文档`}
                    </span>
                    <span>选择后立即插入</span>
                  </div>
                  <div
                    aria-label="可链接的站内文档"
                    className="internal-document-list"
                    role="list"
                  >
                    {filteredDocuments.length > 0 ? (
                      filteredDocuments.map((document) => (
                        <div key={document.id} role="listitem">
                          <button
                            onClick={() => insertDocumentLink(document)}
                            type="button"
                          >
                            <span>
                              <strong>{document.title}</strong>
                              <small>{document.path}</small>
                            </span>
                            {document.status === "draft" ? <em>草稿</em> : null}
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="internal-document-empty">
                        {internalDocuments.length > 0
                          ? "没有匹配的文档"
                          : "暂无其他可访问的文档"}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
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

export function DocumentPreview({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <article className="editor-preview-document">
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
  const [internalDocuments, setInternalDocuments] = useState<
    InternalDocumentOption[]
  >([]);
  const [libraryAssets, setLibraryAssets] = useState<FileAssetSummary[]>([]);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetTargetBlockId, setAssetTargetBlockId] = useState<string | null>(
    null,
  );
  const [insertAfterBlockId, setInsertAfterBlockId] = useState<string | null>(
    null,
  );
  const [titleInput, setTitleInput] = useState("");
  const [openBlockMenu, setOpenBlockMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [mobilePane, setMobilePane] = useState<"edit" | "preview">("edit");
  const [permissionUsers, setPermissionUsers] = useState<UserSummary[]>([]);
  const [permissionTags, setPermissionTags] = useState<UserTagSummary[]>([]);
  const [grants, setGrants] = useState<PermissionGrantSummary[]>([]);
  const [inheritedGrants, setInheritedGrants] = useState<
    InheritedPermissionGrantSummary[]
  >([]);
  const [canManageGrants, setCanManageGrants] = useState(false);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantLevel, setGrantLevel] = useState<PermissionLevel>("viewer");
  const [showPermissions, setShowPermissions] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    blockId: string;
    position: "before" | "after";
  } | null>(null);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const {
    tasks: uploadTasks,
    uploadFiles,
    cancelUpload,
    dismissUpload,
  } = useUploadTask();
  const [messageNotice, setMessage] = useFeedbackNotice();
  const [errorNotice, setError] = useFeedbackNotice();
  const message = messageNotice?.text ?? null;
  const error = errorNotice?.text ?? null;
  const [saveState, setSaveState] = useState<
    "saved" | "dirty" | "saving" | "error"
  >("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const scrollSyncActiveRef = useRef(false);
  const scrollProgressRef = useRef(0);
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
    const [fileResult, blockResult, libraryResult] = await Promise.all([
      getFile(fileId),
      listBlocks(fileId),
      listLibraryAssets(),
    ]);

    setFile(fileResult.file);
    setBlocks(blockResult.blocks);
    setLibraryAssets(libraryResult.assets);
    setTitleInput(fileResult.file.title);
    setSaveState("saved");
    setLastSavedAt(new Date());
  }

  async function loadInternalDocuments() {
    const result = await getFolderTree();
    setInternalDocuments(
      flattenInternalDocuments(result.folders)
        .filter((document) => document.id !== fileId)
        .sort((left, right) => left.title.localeCompare(right.title, "zh-CN")),
    );
  }

  async function openPermissions() {
    setError(null);
    try {
      const [grantResult, userResult] = await Promise.all([
        listPermissionGrants("file", fileId),
        listAssignablePermissionUsers({
          targetType: "file",
          targetId: fileId,
        }),
      ]);
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
      setPermissionUsers(userResult.users);
      setPermissionTags(userResult.tags);
      setGrantUserId("");
      setCanManageGrants(true);
      setShowPermissions(true);
    } catch (caught) {
      setCanManageGrants(false);
      setError(caught instanceof Error ? caught.message : "加载文件权限失败");
    }
  }

  useEffect(() => {
    load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载文件失败");
    });
    loadInternalDocuments().catch(() => {
      // 文档本身仍可编辑；站内链接选择器会显示紧凑空状态。
      setInternalDocuments([]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(
    () => () => {
      if (scrollSyncFrameRef.current !== null) {
        cancelAnimationFrame(scrollSyncFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const editor = editorScrollRef.current;
      const preview = previewScrollRef.current;

      if (
        !editor ||
        !preview ||
        !window.matchMedia("(min-width: 1121px)").matches
      ) {
        return;
      }

      setScrollProgress(editor, scrollProgressRef.current);
      setScrollProgress(preview, scrollProgressRef.current);
    });

    return () => cancelAnimationFrame(frame);
  }, [blocks, titleInput]);

  function synchronizePaneScroll(
    source: HTMLDivElement | null,
    target: HTMLDivElement | null,
  ) {
    if (
      !source ||
      !target ||
      scrollSyncActiveRef.current ||
      !window.matchMedia("(min-width: 1121px)").matches
    ) {
      return;
    }

    scrollSyncActiveRef.current = true;
    const progress = syncScrollProgress(source, target);
    if (progress !== null) {
      scrollProgressRef.current = progress;
    }

    if (scrollSyncFrameRef.current !== null) {
      cancelAnimationFrame(scrollSyncFrameRef.current);
    }
    scrollSyncFrameRef.current = requestAnimationFrame(() => {
      scrollSyncActiveRef.current = false;
      scrollSyncFrameRef.current = null;
    });
  }

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
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (saveState === "dirty" || saveState === "saving") {
        event.preventDefault();
      }
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [saveState]);

  async function addBlockAt(
    type: ContentBlockType,
    text: string,
    afterBlockId?: string,
  ) {
    setError(null);
    setMessage(null);

    try {
      await createBlock({
        fileId,
        type,
        dataJson: buildBlockData(type, text),
        ...(afterBlockId ? { afterBlockId } : {}),
      });
      setMessage("内容块已添加");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "添加内容块失败");
      // 让表单保留已输入的内容，避免失败时丢失。
      throw caught;
    }
  }

  // 拖拽长距离移动时，指针靠近视口上下边缘自动滚动页面。
  const dragPointerY = useRef<number | null>(null);
  useEffect(() => {
    if (!draggingBlockId) {
      dragPointerY.current = null;
      return;
    }

    function trackPointer(event: DragEvent) {
      dragPointerY.current = event.clientY;
    }

    function autoScrollStep() {
      const y = dragPointerY.current;

      if (y !== null) {
        const edge = 96;
        const maxSpeed = 24;

        if (y < edge) {
          window.scrollBy(0, -Math.ceil(((edge - y) / edge) * maxSpeed));
        } else if (y > window.innerHeight - edge) {
          window.scrollBy(
            0,
            Math.ceil(((y - (window.innerHeight - edge)) / edge) * maxSpeed),
          );
        }
      }
    }

    document.addEventListener("dragover", trackPointer);
    const interval = window.setInterval(autoScrollStep, 16);
    return () => {
      document.removeEventListener("dragover", trackPointer);
      window.clearInterval(interval);
      dragPointerY.current = null;
    };
  }, [draggingBlockId]);

  function moveBlockByOffset(blockId: string, offset: -1 | 1) {
    const index = blocks.findIndex((block) => block.id === blockId);
    const targetIndex = index + offset;

    if (index < 0 || targetIndex < 0 || targetIndex >= blocks.length) {
      return;
    }

    const nextBlocks = [...blocks];
    const [movedBlock] = nextBlocks.splice(index, 1);

    if (!movedBlock) {
      return;
    }

    nextBlocks.splice(targetIndex, 0, movedBlock);
    void saveBlockOrder(nextBlocks);
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

  /** 文档内插入的图片统一压缩为 WebP；附件等非图片原样保留。
      限制并发压缩以控制内存峰值，并按原始文件名去重，避免 a.png 与 a.jpg
      压缩后同名被 prepareUploadJobs 判为重复。 */
  async function compressDocumentImages(files: File[]) {
    const results = new Array<File>(files.length);
    const usedNames = new Set<string>();
    const CONCURRENCY = 2;
    let cursor = 0;

    async function worker() {
      while (cursor < files.length) {
        const index = cursor;
        cursor += 1;
        const file = files[index];

        if (!file) continue;

        if (!file.type.startsWith("image/")) {
          results[index] = file;
          continue;
        }

        const base = file.name.replace(/\.[^.]+$/, "") || "image";
        let name = `${base}.webp`;
        let counter = 1;
        while (usedNames.has(name)) {
          name = `${base}-${counter}.webp`;
          counter += 1;
        }
        usedNames.add(name);

        try {
          results[index] = await compressImageFile(file, {
            maxEdge: 1600,
            quality: 0.82,
            outputFileName: name,
          });
        } catch {
          // 无法解码的图片（如 SVG、损坏文件）原样上传，交给后端校验，
          // 避免单张解码失败中止整批上传。
          results[index] = file;
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, files.length) }, () =>
        worker(),
      ),
    );
    return results;
  }

  async function onUploadAssets(files: File[]) {
    if (files.length === 0 || !assetTargetBlockId) {
      return;
    }
    const targetBlockId = assetTargetBlockId;

    setUploadingAsset(true);
    setError(null);
    setMessage(null);

    // 记录已上传成功的资产，供失败时清理，避免残留孤儿。
    const uploadedAssets: FileAssetSummary[] = [];
    const referencedIds = new Set<string>();

    try {
      const prepared = await compressDocumentImages(files);
      const jobs = prepareUploadJobs(prepared, [], "本次选择中包含同名文件");
      const outcomes = await uploadFiles(jobs, (job, options) =>
        uploadAssetDirect({ file: job.file, fileId }, options),
      );
      const assets = outcomes.flatMap((outcome) =>
        outcome.result ? [outcome.result.asset] : [],
      );
      uploadedAssets.push(...assets);
      if (assets.length === 0) return;

      const [firstAsset, ...remainingAssets] = assets;
      if (!firstAsset) return;
      const firstType: ContentBlockType = firstAsset.mimeType.startsWith(
        "image/",
      )
        ? "image"
        : "attachment";
      await updateBlock({
        blockId: targetBlockId,
        type: firstType,
        dataJson: buildAssetBlockData(firstAsset),
      });
      // 已被块引用的资产不再清理；只清理插入失败时尚未被引用的资产。
      referencedIds.add(firstAsset.id);
      let afterBlockId = targetBlockId;
      for (const asset of remainingAssets) {
        const type: ContentBlockType = asset.mimeType.startsWith("image/")
          ? "image"
          : "attachment";
        const result = await createBlock({
          fileId,
          type,
          dataJson: buildAssetBlockData(asset),
          afterBlockId,
        });
        referencedIds.add(asset.id);
        afterBlockId = result.block.id;
      }
      setMessage(
        assets.length === 1
          ? firstAsset.mimeType.startsWith("image/")
            ? "图片已插入"
            : "附件已插入"
          : `${assets.length} 个文件已插入`,
      );
      closeAssetPicker();
      await load();
    } catch (caught) {
      // 块写入失败时只清理已上传但尚未被任何块引用的资产，避免部分成功后
      // 把已插入的资产误删；已被引用的资产后端也会拒绝删除。
      await Promise.allSettled(
        uploadedAssets
          .filter((asset) => !referencedIds.has(asset.id))
          .map((asset) => deleteLibraryAsset(asset.id)),
      );
      // 部分块可能已插入成功，刷新列表让已插入的内容可见。
      if (referencedIds.size > 0) await load();
      setError(caught instanceof Error ? caught.message : "插入文件失败");
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

  function moveBlock(
    blockId: string,
    targetBlockId: string,
    position: "before" | "after",
  ) {
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

    // 源块已移除，目标块的索引需要重新计算后再按方向插入。
    const adjustedTargetIndex = nextBlocks.findIndex(
      (block) => block.id === targetBlockId,
    );
    nextBlocks.splice(
      position === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex,
      0,
      movedBlock,
    );
    setDropTarget(null);
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
    const nextData = ["divider", "table", "math", "bilibili"].includes(type)
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
      // 本地 state 已是最新（patchBlockData 已更新），无需全量 load——
      // 否则保存期间编辑的其他块会被服务器旧数据覆盖。
      setSaveState("saved");
      setLastSavedAt(new Date());
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

    const nameError = getResourceNameError(titleInput, "文档名称");
    if (nameError) {
      setError(nameError);
      setSaveState("error");
      return;
    }
    const normalizedTitle = normalizeResourceName(titleInput);

    if (normalizedTitle === file?.title) {
      setTitleInput(normalizedTitle);
      return;
    }

    setSaveState("saving");
    try {
      await updateFile({
        fileId,
        title: normalizedTitle,
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

    if (!grantUserId) {
      setError("请选择成员");
      return;
    }

    try {
      await upsertPermissionGrant({
        targetType: "file",
        targetId: fileId,
        userId: grantUserId,
        level: grantLevel,
      });
      const grantResult = await listPermissionGrants("file", fileId);
      setGrants(grantResult.grants);
      setInheritedGrants(grantResult.inheritedGrants);
      setGrantUserId("");
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
        userId: grant.userId,
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
                <small>从设备上传，或从文件页选择</small>
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
              href={attachmentDownloadUrl(url)}
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
                <small>从设备上传，或从文件页选择</small>
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

    if (block.type === "bilibili") {
      return (
        <div className="bilibili-block-editor">
          <AutoTextarea
            className="doc-block-input"
            onBlur={() => void onSaveBlock(block)}
            onChange={(event) =>
              patchBlockData(block, { embedCode: event.target.value })
            }
            placeholder='粘贴 B站视频链接，或以 <iframe src="//player.bilibili.com/player.html?..."> 开头的嵌入代码'
            rows={4}
            value={getBlockDataString(block, "embedCode")}
          />
          <small>
            仅提取并加载 Bilibili 官方播放器地址，其他 HTML 属性和脚本不会执行。
          </small>
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
          internalDocuments={internalDocuments}
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
    <div className="workspace content-editor-workspace">
      <section className="page-head compact editor-title-bar">
        <div>
          <input
            className="title-input"
            maxLength={120}
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
          {/* 已发布不再挂标签：这一格没有「发布」按钮本身就说明它已经发过了。
              已归档是异常状态，仍然要明说。 */}
          {isPublished ? null : isArchived ? (
            <span className="publish-state-badge muted">已归档</span>
          ) : (
            <button
              aria-label="发布文档"
              className="button secondary content-editor-publish-button"
              onClick={onPublishFile}
              title="发布文档"
              type="button"
            >
              <Send aria-hidden="true" className="button-icon" />
              <span>发布</span>
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
              {file?.permission === "owner" ? (
                <button
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    void openPermissions();
                  }}
                  type="button"
                >
                  <Users aria-hidden="true" />
                  权限
                </button>
              ) : null}
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

      <FeedbackNotice notice={errorNotice} tone="error" />
      <FeedbackNotice notice={messageNotice} tone="success" />

      <section className="editor-workspace">
        <div
          aria-label="文档编辑视图"
          className="segmented-control mobile-editor-pane-switch"
          role="group"
        >
          <button
            aria-pressed={mobilePane === "edit"}
            className={mobilePane === "edit" ? "active" : ""}
            onClick={() => setMobilePane("edit")}
            type="button"
          >
            <Pencil aria-hidden="true" />
            编辑
          </button>
          <button
            aria-pressed={mobilePane === "preview"}
            className={mobilePane === "preview" ? "active" : ""}
            onClick={() => setMobilePane("preview")}
            type="button"
          >
            <Eye aria-hidden="true" />
            预览
          </button>
        </div>
        <div className="editor-split">
          <section
            className={`editor-pane editor-format-pane ${
              mobilePane === "edit" ? "mobile-pane-active" : ""
            }`}
            aria-label="格式编辑"
          >
            <header className="editor-pane-head">
              <strong>格式编辑</strong>
              <span>选择区块类型并编辑内容</span>
            </header>
            <div
              className="editor-format-scroll"
              onScroll={() =>
                synchronizePaneScroll(
                  editorScrollRef.current,
                  previewScrollRef.current,
                )
              }
              ref={editorScrollRef}
            >
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
                    <Fragment key={block.id}>
                      <article
                        className={`doc-block ${draggingBlockId === block.id ? "dragging" : ""} ${
                          dropTarget?.blockId === block.id &&
                          draggingBlockId !== block.id
                            ? `drop-target drop-${dropTarget.position}`
                            : ""
                        }`}
                        id={`block-${block.id}`}
                        onDragOver={(event) => {
                          event.preventDefault();

                          if (!draggingBlockId) {
                            return;
                          }

                          if (draggingBlockId === block.id) {
                            setDropTarget((current) =>
                              current ? null : current,
                            );
                            return;
                          }

                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          const position =
                            event.clientY < rect.top + rect.height / 2
                              ? "before"
                              : "after";

                          setDropTarget((current) =>
                            current?.blockId === block.id &&
                            current.position === position
                              ? current
                              : { blockId: block.id, position },
                          );
                        }}
                        onDrop={() => {
                          if (
                            draggingBlockId &&
                            dropTarget?.blockId === block.id
                          ) {
                            moveBlock(
                              draggingBlockId,
                              block.id,
                              dropTarget.position,
                            );
                          }
                          setDraggingBlockId(null);
                          setDropTarget(null);
                        }}
                      >
                        <div
                          className="doc-block-controls"
                          data-menu-root="true"
                        >
                          <button
                            aria-label="在下方插入块"
                            className="icon-button subtle block-insert-button"
                            onClick={() =>
                              setInsertAfterBlockId((current) =>
                                current === block.id ? null : block.id,
                              )
                            }
                            title="在下方插入块"
                            type="button"
                          >
                            <Plus aria-hidden="true" />
                          </button>
                          <span
                            className="drag-handle"
                            draggable
                            onDragEnd={() => {
                              setDraggingBlockId(null);
                              setDropTarget(null);
                            }}
                            onDragStart={() => {
                              setDraggingBlockId(block.id);
                              setDropTarget(null);
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
                      {insertAfterBlockId === block.id ? (
                        <AddBlockForm
                          autoFocus
                          className="doc-add-block doc-inline-inserter"
                          onCancel={() => setInsertAfterBlockId(null)}
                          onSubmit={(type, text) =>
                            addBlockAt(type, text, block.id)
                          }
                          submitLabel="插入"
                        />
                      ) : null}
                    </Fragment>
                  ))}
                  {blocks.length === 0 ? (
                    <div className="empty-state">这个文件还没有内容块。</div>
                  ) : null}
                  <AddBlockForm
                    className="doc-add-block"
                    onSubmit={(type, text) => addBlockAt(type, text)}
                  />
                  {openBlockMenu && menuBlock ? (
                    <div
                      className="context-menu floating-block-menu"
                      data-menu-root="true"
                      style={{ left: openBlockMenu.x, top: openBlockMenu.y }}
                    >
                      <button
                        onClick={() => {
                          setOpenBlockMenu(null);
                          setInsertAfterBlockId(menuBlock.id);
                        }}
                        type="button"
                      >
                        在下方插入块
                      </button>
                      {blocks.findIndex((block) => block.id === menuBlock.id) >
                      0 ? (
                        <button
                          onClick={() => {
                            setOpenBlockMenu(null);
                            moveBlockByOffset(menuBlock.id, -1);
                          }}
                          type="button"
                        >
                          上移
                        </button>
                      ) : null}
                      {blocks.findIndex((block) => block.id === menuBlock.id) <
                      blocks.length - 1 ? (
                        <button
                          onClick={() => {
                            setOpenBlockMenu(null);
                            moveBlockByOffset(menuBlock.id, 1);
                          }}
                          type="button"
                        >
                          下移
                        </button>
                      ) : null}
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
            </div>
          </section>
          <aside
            className={`editor-pane editor-preview-pane ${
              mobilePane === "preview" ? "mobile-pane-active" : ""
            }`}
            aria-label="格式预览"
          >
            <header className="editor-pane-head">
              <strong>格式预览</strong>
              <span>内容修改会在这里即时呈现</span>
            </header>
            <div
              className="editor-preview-scroll"
              onScroll={() =>
                synchronizePaneScroll(
                  previewScrollRef.current,
                  editorScrollRef.current,
                )
              }
              ref={previewScrollRef}
            >
              <DocumentPreview blocks={blocks} />
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
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    void onUploadAssets(files);
                  }}
                  multiple
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
                className={`permission-inheritance-summary ${grants.length > 0 ? "has-overrides" : ""}`}
              >
                <strong>
                  {grants.length > 0 ? "包含例外权限" : "沿用文件夹权限"}
                </strong>
                <span>
                  {grants.length > 0
                    ? `当前文档为 ${grants.length} 位成员单独设置；其他成员继续从所在文件夹继承。`
                    : "当前文件没有单独设置，权限会随所在文件夹自动变化。"}
                </span>
              </div>
              <div className="panel-title-row">
                <h2>
                  <Users aria-hidden="true" className="heading-icon" />
                  当前文件的例外
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
                <p className="muted">你没有调整这个文件权限的权限。</p>
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
                        @{grant.user.username} · 当前文档单独设置
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
                        title="恢复继承"
                        type="button"
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
      <UploadTaskToast
        onCancel={cancelUpload}
        onDismiss={dismissUpload}
        tasks={uploadTasks}
      />
    </div>
  );
}
