"use client";

import "./AssetPreviewDialog.css";
import { useEffect } from "react";
import { Download, File as FileIcon, X } from "lucide-react";
import dynamic from "next/dynamic";
import { apiResourceUrl, assetDownloadUrl } from "@/lib/api";

const AssetTextPreview = dynamic(
  () => import("./AssetTextPreview").then((module) => module.AssetTextPreview),
  { ssr: false },
);
const PdfAssetPreview = dynamic(
  () => import("./PdfAssetPreview").then((module) => module.PdfAssetPreview),
  { ssr: false },
);

export type AssetPreviewTarget = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadPath?: string;
  imagePath?: string;
  previewPath?: string;
};

const PREVIEWABLE_IMAGE_MIMES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type AssetPreviewKind =
  "image" | "pdf" | "markdown" | "text" | "unsupported";

export function getAssetPreviewKind(
  filename: string,
  mimeType: string,
): AssetPreviewKind {
  const lowerName = filename.trim().toLowerCase();
  const normalizedMime = mimeType.trim().toLowerCase();
  if (PREVIEWABLE_IMAGE_MIMES.has(normalizedMime)) return "image";
  if (
    lowerName.endsWith(".pdf") &&
    ["application/pdf", "application/octet-stream"].includes(normalizedMime)
  ) {
    return "pdf";
  }
  if (
    (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) &&
    ["text/markdown", "text/plain", "application/octet-stream"].includes(
      normalizedMime,
    )
  ) {
    return "markdown";
  }
  if (
    lowerName.endsWith(".txt") &&
    ["text/plain", "application/octet-stream"].includes(normalizedMime)
  ) {
    return "text";
  }
  return "unsupported";
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

function formatFileKind(filename: string) {
  const extension = filename.includes(".")
    ? filename.split(".").pop()?.trim()
    : "";

  if (!extension || extension.length > 8) {
    return "文件";
  }

  return extension.toLocaleUpperCase();
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

  const previewKind = getAssetPreviewKind(asset.filename, asset.mimeType);
  const canPreview = previewKind !== "unsupported";
  const fileKind = formatFileKind(asset.filename);
  const downloadUrl = asset.downloadPath
    ? apiResourceUrl(asset.downloadPath)
    : assetDownloadUrl(asset.id);
  const imageUrl = apiResourceUrl(asset.imagePath ?? `/assets/${asset.id}`);
  const previewPath = asset.previewPath ?? `/assets/${asset.id}/preview`;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-describedby={canPreview ? undefined : "asset-preview-description"}
        aria-labelledby="asset-preview-title"
        aria-modal="true"
        className={`modal-panel asset-preview-dialog ${
          previewKind === "image"
            ? "asset-preview-dialog--image"
            : canPreview
              ? "asset-preview-dialog--document"
              : "asset-preview-dialog--file"
        }`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <h2 id="asset-preview-title" title={asset.filename}>
            {asset.filename}
          </h2>
          <button
            className="icon-button subtle"
            aria-label="关闭文件预览"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body asset-preview-body">
          {previewKind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={asset.filename}
              className="asset-preview-image"
              src={imageUrl}
            />
          ) : previewKind === "pdf" ? (
            <PdfAssetPreview previewPath={previewPath} />
          ) : previewKind === "markdown" || previewKind === "text" ? (
            <AssetTextPreview
              markdown={previewKind === "markdown"}
              previewPath={previewPath}
            />
          ) : (
            <div className="asset-preview-fallback">
              <div className="asset-preview-file-mark" aria-hidden="true">
                <FileIcon />
                <span>{fileKind}</span>
              </div>
              <div className="asset-preview-message">
                <strong>无法在线预览</strong>
                <span className="muted" id="asset-preview-description">
                  下载后可使用本地应用打开。
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="asset-preview-meta">
            {fileKind} <i aria-hidden="true">·</i> {formatSize(asset.sizeBytes)}
          </span>
          <div className="button-row">
            <a className="button" href={downloadUrl}>
              <Download aria-hidden="true" />
              下载
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
