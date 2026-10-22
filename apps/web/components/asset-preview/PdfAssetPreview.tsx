"use client";

import { ExternalLink, File as FileIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { resolvePdfPreviewUrl } from "@/lib/api";

export function PdfAssetPreview({ previewPath }: { previewPath: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setSource(null);
    setError("");

    void resolvePdfPreviewUrl(previewPath, controller.signal)
      .then((url) => {
        if (!controller.signal.aborted) setSource(url);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "无法打开 PDF");
      });

    return () => controller.abort();
  }, [previewPath]);

  return (
    <div className="asset-preview-fallback">
      <div className="asset-preview-file-mark" aria-hidden="true">
        <FileIcon />
        <span>PDF</span>
      </div>
      <div className="asset-preview-message">
        <strong>在新窗口中查看 PDF</strong>
        {error ? (
          <span role="alert">{error}</span>
        ) : source ? (
          <a
            className="button asset-preview-pdf-open"
            href={source}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" />
            新窗口打开
          </a>
        ) : (
          <span className="muted" role="status">
            正在准备文件…
          </span>
        )}
      </div>
    </div>
  );
}
