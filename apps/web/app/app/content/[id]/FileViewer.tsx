"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Edit3 } from "lucide-react";
import type { ContentBlock, FileDetail } from "@/lib/api";
import { getFile, listBlocks } from "@/lib/api";
import { fileStatusLabel, fileTypeLabel, permissionLabel } from "@/lib/labels";
import { APP_ROUTES, contentEdit } from "@/lib/routes";
import { RenderBlockContent } from "./ContentBlockRenderer";

function canEditContent(permission: FileDetail["permission"]) {
  return (
    permission === "owner" ||
    permission === "editor" ||
    permission === "lecturer"
  );
}

export function FileViewer({ fileId }: { fileId: string }) {
  const [file, setFile] = useState<FileDetail | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([getFile(fileId), listBlocks(fileId)])
      .then(([fileResult, blockResult]) => {
        if (!active) return;
        setFile(fileResult.file);
        setBlocks(blockResult.blocks);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "加载文档失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fileId]);

  return (
    <div className="content-viewer workspace">
      <Link className="page-back-link" href={APP_ROUTES.content}>
        <ArrowLeft aria-hidden="true" />
        返回文档
      </Link>

      {error ? <p className="error-text">{error}</p> : null}

      {loading ? (
        <div className="content-viewer-loading">正在加载文档…</div>
      ) : file ? (
        <>
          <header className="content-viewer-header">
            <div>
              <h1>{file.title}</h1>
              <div className="content-viewer-meta" aria-label="文件信息">
                <span>{fileTypeLabel(file.type)}</span>
                <span>{fileStatusLabel(file.status)}</span>
                <span>{permissionLabel(file.permission)}</span>
                <span>{blocks.length} 个内容块</span>
              </div>
            </div>
            {canEditContent(file.permission) ? (
              <div className="button-row">
                <Link className="button secondary" href={contentEdit(fileId)}>
                  <Edit3 aria-hidden="true" className="button-icon" />
                  编辑
                </Link>
              </div>
            ) : null}
          </header>

          <article className="content-viewer-document">
            {blocks.length > 0 ? (
              blocks.map((block) => (
                <div className="content-viewer-block" key={block.id}>
                  <RenderBlockContent block={block} />
                </div>
              ))
            ) : (
              <div className="empty-state">这个文件还没有内容。</div>
            )}
          </article>
        </>
      ) : null}
    </div>
  );
}
