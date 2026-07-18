"use client";

import { ChangeEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import {
  Download,
  File,
  Image,
  LayoutGrid,
  Rows3,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  AssetInUseError,
  AssetReferenceSummary,
  deleteLibraryAsset,
  FileAssetSummary,
  listLibraryAssets,
  uploadAsset,
} from "@/lib/api";
import {
  assetTypeLabel,
  formatDateTime,
  formatRelativeTime,
} from "@/lib/labels";
import { contentDetail, teachingPresent } from "@/lib/routes";
import { SortIconSelect } from "@/components/SortIconSelect";

type AssetKindFilter = "all" | "image" | "file";
type AssetSort = "newest" | "oldest" | "name" | "references";
type AssetView = "grid" | "list";

const SORT_OPTIONS = [
  { value: "newest", label: "最新上传" },
  { value: "oldest", label: "最早上传" },
  { value: "name", label: "按名称" },
  { value: "references", label: "按引用数" },
] as const;

export function LibraryClient() {
  const [assets, setAssets] = useState<FileAssetSummary[]>([]);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<AssetKindFilter>("all");
  const [sort, setSort] = useState<AssetSort>("newest");
  const [view, setView] = useState<AssetView>("grid");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileAssetSummary | null>(
    null,
  );
  const [blockedDelete, setBlockedDelete] = useState<{
    filename: string;
    message: string;
    references: AssetReferenceSummary[];
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return assets
      .filter((asset) => {
        const matchesQuery = normalizedQuery
          ? asset.filename.toLowerCase().includes(normalizedQuery) ||
            asset.mimeType.toLowerCase().includes(normalizedQuery) ||
            assetTypeLabel(asset.mimeType, asset.filename)
              .toLowerCase()
              .includes(normalizedQuery)
          : true;
        const isImage = asset.mimeType.startsWith("image/");
        const matchesKind =
          kindFilter === "all" ||
          (kindFilter === "image" && isImage) ||
          (kindFilter === "file" && !isImage);

        return matchesQuery && matchesKind;
      })
      .sort((left, right) => {
        if (sort === "name") {
          return left.filename.localeCompare(right.filename);
        }

        if (sort === "references") {
          return (right.referenceCount ?? 0) - (left.referenceCount ?? 0);
        }

        const leftTime = new Date(left.createdAt ?? 0).getTime();
        const rightTime = new Date(right.createdAt ?? 0).getTime();

        return sort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
      });
  }, [assets, kindFilter, query, sort]);
  const selectedAsset = selectedAssetId
    ? (filteredAssets.find((asset) => asset.id === selectedAssetId) ?? null)
    : null;
  async function load() {
    const result = await listLibraryAssets();
    setAssets(result.assets);
    setSelectedAssetId((current) =>
      current && result.assets.some((asset) => asset.id === current)
        ? current
        : null,
    );
  }

  useEffect(() => {
    load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载网盘失败");
    });
  }, []);

  useEffect(() => {
    if (!showMobileDetail || !window.matchMedia("(max-width: 760px)").matches) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showMobileDetail]);

  useEffect(() => {
    if (
      selectedAssetId &&
      !filteredAssets.some((asset) => asset.id === selectedAssetId)
    ) {
      setSelectedAssetId(null);
      setShowMobileDetail(false);
    }
  }, [filteredAssets, selectedAssetId]);

  function selectAsset(assetId: string) {
    setSelectedAssetId(assetId);
    setShowMobileDetail(true);
  }

  function clearSelection() {
    setSelectedAssetId(null);
    setShowMobileDetail(false);
  }

  function clearSelectionFromBackground(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;

    if (
      !(target instanceof HTMLElement) ||
      target.closest(
        ".asset-card, .asset-list-row, button, a, input, select, label",
      )
    ) {
      return;
    }

    clearSelection();
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);
    setBlockedDelete(null);

    try {
      await uploadAsset({ file });
      setMessage("文件已加入网盘");
      setShowUploadModal(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(asset: FileAssetSummary) {
    setError(null);
    setMessage(null);
    setBlockedDelete(null);

    try {
      await deleteLibraryAsset(asset.id);
      setMessage("文件已删除");
      setDeleteTarget(null);
      await load();
    } catch (caught) {
      if (caught instanceof AssetInUseError) {
        setDeleteTarget(null);
        setBlockedDelete({
          filename: asset.filename,
          message: caught.message,
          references: caught.references,
        });
        return;
      }

      setError(caught instanceof Error ? caught.message : "删除失败");
    }
  }

  return (
    <div className="workspace library-workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">资源管理</p>
          <h1>文件</h1>
          <p className="muted">集中上传、检索和复用图片与附件资源。</p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="library-layout">
        <div className="workbench-main" onClick={clearSelectionFromBackground}>
          <div className="list-toolbar">
            <label className="search-field">
              <Search aria-hidden="true" />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索文件名或类型"
                value={query}
              />
            </label>
            <div className="toolbar-row">
              <button
                className="button"
                onClick={() => setShowUploadModal(true)}
                type="button"
              >
                <Upload aria-hidden="true" className="button-icon" />
                上传文件
              </button>
              <select
                className="select compact-select"
                value={kindFilter}
                onChange={(event) =>
                  setKindFilter(event.target.value as AssetKindFilter)
                }
              >
                <option value="all">全部类型</option>
                <option value="image">图片</option>
                <option value="file">附件</option>
              </select>
              <SortIconSelect
                onChange={setSort}
                options={SORT_OPTIONS}
                value={sort}
              />
              <div
                className="segmented-control library-view-toggle"
                aria-label="文件展示方式"
              >
                <button
                  aria-label="网格视图"
                  aria-pressed={view === "grid"}
                  className={view === "grid" ? "active" : ""}
                  onClick={() => setView("grid")}
                  title="网格视图"
                  type="button"
                >
                  <LayoutGrid aria-hidden="true" strokeWidth={1.8} />
                </button>
                <button
                  aria-label="列表视图"
                  aria-pressed={view === "list"}
                  className={view === "list" ? "active" : ""}
                  onClick={() => setView("list")}
                  title="列表视图"
                  type="button"
                >
                  <Rows3 aria-hidden="true" strokeWidth={1.8} />
                </button>
              </div>
            </div>
          </div>

          {view === "grid" ? (
            <div className="asset-grid">
              {filteredAssets.map((asset) => {
                const isImage = asset.mimeType.startsWith("image/");
                const Icon = isImage ? Image : File;

                return (
                  <article
                    className={
                      selectedAsset?.id === asset.id
                        ? "asset-card active"
                        : "asset-card"
                    }
                    key={asset.id}
                    onClick={() => selectAsset(asset.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectAsset(asset.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="asset-preview">
                      {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={asset.filename} src={asset.url} />
                      ) : (
                        <Icon aria-hidden="true" />
                      )}
                    </div>
                    <div className="asset-info">
                      <strong>{asset.filename}</strong>
                      <span title={asset.mimeType}>
                        {assetTypeLabel(asset.mimeType, asset.filename)}
                      </span>
                      <small>
                        {formatFileSize(asset.sizeBytes)} /{" "}
                        {formatRelativeTime(asset.createdAt)}
                      </small>
                    </div>
                    <div className="asset-actions">
                      <span>{asset.referenceCount ?? 0} 处引用</span>
                      <button
                        className="inline-icon-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTarget(asset);
                        }}
                        title="删除"
                        type="button"
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })}

              {filteredAssets.length === 0 ? (
                <LibraryEmpty assetsCount={assets.length} />
              ) : null}
            </div>
          ) : (
            <div className="asset-list">
              {filteredAssets.map((asset) => {
                const isImage = asset.mimeType.startsWith("image/");
                const Icon = isImage ? Image : File;

                return (
                  <button
                    className={
                      selectedAsset?.id === asset.id
                        ? "asset-list-row active"
                        : "asset-list-row"
                    }
                    key={asset.id}
                    onClick={() => selectAsset(asset.id)}
                    type="button"
                  >
                    <Icon aria-hidden="true" />
                    <span>
                      <strong>{asset.filename}</strong>
                      <small title={asset.mimeType}>
                        {assetTypeLabel(asset.mimeType, asset.filename)}
                      </small>
                    </span>
                    <em>{formatFileSize(asset.sizeBytes)}</em>
                    <em>{asset.referenceCount ?? 0} 处引用</em>
                  </button>
                );
              })}
              {filteredAssets.length === 0 ? (
                <LibraryEmpty assetsCount={assets.length} />
              ) : null}
            </div>
          )}
        </div>

        <button
          aria-label="关闭文件详情"
          className={`asset-detail-backdrop ${showMobileDetail ? "open" : ""}`}
          onClick={clearSelection}
          type="button"
        />

        <aside
          aria-label="文件详情"
          className={`asset-detail-panel sticky-panel ${
            showMobileDetail ? "mobile-open" : ""
          }`}
        >
          <button
            aria-label="关闭文件详情"
            className="asset-detail-close"
            onClick={clearSelection}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" />
          </button>
          {selectedAsset ? (
            <>
              <div className="asset-detail-preview">
                {selectedAsset.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={selectedAsset.filename} src={selectedAsset.url} />
                ) : (
                  <File aria-hidden="true" />
                )}
              </div>
              <div className="asset-detail-body">
                <h2>{selectedAsset.filename}</h2>
                <dl>
                  <div>
                    <dt>类型</dt>
                    <dd title={selectedAsset.mimeType}>
                      {assetTypeLabel(
                        selectedAsset.mimeType,
                        selectedAsset.filename,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>大小</dt>
                    <dd>{formatFileSize(selectedAsset.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>上传时间</dt>
                    <dd>{formatDateTime(selectedAsset.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>引用</dt>
                    <dd>{selectedAsset.referenceCount ?? 0} 处</dd>
                  </div>
                </dl>
                <div className="button-row left">
                  <a
                    className="button secondary"
                    href={selectedAsset.url}
                    target="_blank"
                  >
                    <Download aria-hidden="true" className="button-icon" />
                    下载
                  </a>
                  <button
                    className="button danger"
                    onClick={() => setDeleteTarget(selectedAsset)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" className="button-icon" />
                    删除
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-panel compact">
              <strong>未选择文件</strong>
              <span>选择一个文件查看详情和操作。</span>
            </div>
          )}
        </aside>
      </section>

      {showUploadModal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel">
            <div className="modal-head">
              <h2>上传到网盘</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowUploadModal(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <label className="upload-dropzone large">
                <input
                  disabled={uploading}
                  onChange={(event) => void onUpload(event)}
                  type="file"
                />
                <span>
                  <Upload aria-hidden="true" />
                  {uploading ? "上传中" : "选择文件"}
                </span>
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel">
            <div className="modal-head">
              <h2>删除文件</h2>
              <button
                className="icon-button subtle"
                onClick={() => setDeleteTarget(null)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <p className="muted">
                确定删除“{deleteTarget.filename}
                ”吗？如果它正在被文档或课件引用，系统会拒绝删除并显示引用位置。
              </p>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setDeleteTarget(null)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button danger"
                  onClick={() => void onDelete(deleteTarget)}
                  type="button"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {blockedDelete ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="asset-delete-blocked-title"
            aria-modal="true"
            className="modal-panel asset-reference-modal"
            role="dialog"
          >
            <div className="modal-head">
              <h2 id="asset-delete-blocked-title">文件无法删除</h2>
              <button
                className="icon-button subtle"
                onClick={() => setBlockedDelete(null)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <div className="asset-reference-summary">
                <strong>{blockedDelete.message}</strong>
                <p>
                  “{blockedDelete.filename}
                  ”正在被以下内容使用。请先从对应文档或课件中移除，再删除这个文件。
                </p>
              </div>
              <div className="asset-reference-list">
                {blockedDelete.references.map((reference) => {
                  if (reference.targetType === "teaching_deck") {
                    return (
                      <a
                        href={teachingPresent(reference.deckId)}
                        key={`deck-${reference.deckId}-${reference.itemId}`}
                      >
                        <span>课件</span>
                        <strong>{reference.deckTitle}</strong>
                      </a>
                    );
                  }

                  return (
                    <a
                      href={contentDetail(reference.fileId)}
                      key={`file-${reference.fileId}-${reference.blockId}`}
                    >
                      <span>文档</span>
                      <strong>{reference.fileTitle}</strong>
                    </a>
                  );
                })}
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="button secondary"
                onClick={() => setBlockedDelete(null)}
                type="button"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LibraryEmpty({ assetsCount }: { assetsCount: number }) {
  return (
    <div className="empty-panel asset-empty">
      <strong>{assetsCount === 0 ? "网盘为空" : "没有匹配的文件"}</strong>
      <span>
        {assetsCount === 0
          ? "上传过的图片和附件会自动收录在这里。"
          : "换一个关键词或筛选条件试试。"}
      </span>
    </div>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
