"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useState } from "react";
import { Edit3 } from "lucide-react";
import type { ContentBlock, FileDetail } from "@/lib/api";
import { getFile, listBlocks } from "@/lib/api";
import { fileStatusLabel, permissionLabel } from "@/lib/labels";
import { contentEdit } from "@/lib/routes";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { RenderBlockContent } from "./ContentBlockRenderer";
import { SkeletonRows } from "@/components/system/ProgressiveLoading";

function canEditContent(permission: FileDetail["permission"]) {
  return (
    permission === "owner" ||
    permission === "editor" ||
    permission === "lecturer"
  );
}

export function FileViewer({ fileId }: { fileId: string }) {
  const [file, setFile] = useState<FileDetail | null>(null);
  useDocumentTitle(file?.title ?? null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const headings = blocks
    .filter((block) => block.type.startsWith("heading_"))
    .map((block) => ({
      id: `heading-${block.id}`,
      level: Number(block.type.slice("heading_".length)),
      text: getBlockText(block) || "未命名标题",
    }));

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
      {error ? <p className="error-text">{error}</p> : null}

      {loading ? (
        <div className="content-viewer-progressive-loading" role="status">
          <span className="skeleton-block content-viewer-title-skeleton" />
          <SkeletonRows count={6} />
        </div>
      ) : file ? (
        <>
          <header className="content-viewer-header">
            <div>
              <div className="content-viewer-title">
                <span
                  className="content-viewer-status"
                  data-status={file.status}
                >
                  {fileStatusLabel(file.status)}
                </span>
                <h1>{file.title}</h1>
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

          {file.importWarnings && file.importWarnings.length > 0 ? (
            <details className="content-import-report">
              <summary>
                Markdown 导入报告 · {file.importWarnings.length} 项需要注意
              </summary>
              <ul>
                {file.importWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : null}

          <div
            className={
              headings.length > 1
                ? "content-viewer-body has-toc"
                : "content-viewer-body"
            }
          >
            {headings.length > 1 ? (
              <aside className="content-viewer-toc" aria-label="文档目录">
                <strong>目录</strong>
                <nav>
                  {headings.map((heading) => (
                    <a
                      href={`#${heading.id}`}
                      key={heading.id}
                      style={
                        { "--heading-level": heading.level } as CSSProperties
                      }
                      title={heading.text}
                    >
                      {heading.text}
                    </a>
                  ))}
                </nav>
              </aside>
            ) : null}
            <article className="content-viewer-document">
              {blocks.length > 0 ? (
                blocks.map((block) => (
                  <div
                    className="content-viewer-block"
                    id={
                      block.type.startsWith("heading_")
                        ? `heading-${block.id}`
                        : undefined
                    }
                    key={block.id}
                  >
                    <RenderBlockContent block={block} />
                  </div>
                ))
              ) : (
                <div className="empty-state">这个文件还没有内容。</div>
              )}
            </article>
          </div>
        </>
      ) : null}
    </div>
  );
}

function getBlockText(block: ContentBlock) {
  if (!block.dataJson || typeof block.dataJson !== "object") return "";
  const text = (block.dataJson as { text?: unknown }).text;
  return typeof text === "string" ? text.replace(/[*_`~[\]]/g, "").trim() : "";
}
