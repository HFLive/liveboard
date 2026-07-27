"use client";

import { useEffect } from "react";
import { Download, File as FileIcon, X } from "lucide-react";
import { apiResourceUrl, assetDownloadUrl } from "@/lib/api";

export type AssetPreviewTarget = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

// 与 API 的 SAFE_INLINE_IMAGE_MIMES 保持一致：只有这些类型会被内联返回，
// 其余类型按附件下载，因此只有它们能在应用内直接预览。
const PREVIEWABLE_IMAGE_MIMES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function canPreviewAssetInline(mimeType: string) {
  return PREVIEWABLE_IMAGE_MIMES.has(mimeType);
}

function formatSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${sizeBytes} B`;
}

export function AssetPreviewDialog({
  asset,
  onClose,
}: {
  asset: AssetPreviewTarget | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!asset) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [asset, onClose]);

  if (!asset) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby="asset-preview-title"
        className="modal-panel asset-preview-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <h2 id="asset-preview-title" title={asset.filename}>
            {asset.filename}
          </h2>
          <button
            className="icon-button subtle"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body asset-preview-body">
          {canPreviewAssetInline(asset.mimeType) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={asset.filename}
              className="asset-preview-image"
              src={apiResourceUrl(`/assets/${asset.id}`)}
            />
          ) : (
            <div className="asset-preview-fallback">
              <FileIcon aria-hidden="true" />
              <strong>{asset.filename}</strong>
              <span className="muted">
                此类型文件暂不支持在线预览，可下载后查看。
              </span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="muted">{formatSize(asset.sizeBytes)}</span>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={onClose}
              type="button"
            >
              关闭
            </button>
            <a className="button" href={assetDownloadUrl(asset.id)}>
              <Download aria-hidden="true" />
              下载
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
