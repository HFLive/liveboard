"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useState } from "react";
import { ALargeSmall, Check, Edit3, Minus, Plus } from "lucide-react";
import type { ContentBlock, FileDetail } from "@/lib/api";
import { dismissImportWarnings, getFile, listBlocks } from "@/lib/api";
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

type ReaderFont = "serif" | "kai" | "sans";

const READER_PREFERENCES_KEY = "liveboard:reader-preferences";
const DEFAULT_READER_FONT: ReaderFont = "serif";
const DEFAULT_READER_FONT_SIZE = 19;
const MIN_READER_FONT_SIZE = 16;
const MAX_READER_FONT_SIZE = 24;
const readerFontOptions: Array<{ value: ReaderFont; label: string }> = [
  { value: "serif", label: "宋体" },
  { value: "kai", label: "楷体" },
  { value: "sans", label: "黑体" },
];

function isReaderFont(value: unknown): value is ReaderFont {
  return readerFontOptions.some((option) => option.value === value);
}

export function FileViewer({ fileId }: { fileId: string }) {
  const [file, setFile] = useState<FileDetail | null>(null);
  useDocumentTitle(file?.title ?? null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissingReport, setDismissingReport] = useState(false);
  const [readerFont, setReaderFont] = useState<ReaderFont>(DEFAULT_READER_FONT);
  const [readerFontSize, setReaderFontSize] = useState(
    DEFAULT_READER_FONT_SIZE,
  );
  const [readerPreferencesReady, setReaderPreferencesReady] = useState(false);
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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(READER_PREFERENCES_KEY);
      if (stored) {
        const preferences = JSON.parse(stored) as {
          font?: unknown;
          fontSize?: unknown;
        };
        if (isReaderFont(preferences.font)) {
          setReaderFont(preferences.font);
        }
        if (typeof preferences.fontSize === "number") {
          setReaderFontSize(
            Math.max(
              MIN_READER_FONT_SIZE,
              Math.min(MAX_READER_FONT_SIZE, preferences.fontSize),
            ),
          );
        }
      }
    } catch {
      // 损坏的本地偏好不应阻塞正文阅读，直接回退默认排版。
    } finally {
      setReaderPreferencesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!readerPreferencesReady) return;
    window.localStorage.setItem(
      READER_PREFERENCES_KEY,
      JSON.stringify({ font: readerFont, fontSize: readerFontSize }),
    );
  }, [readerFont, readerFontSize, readerPreferencesReady]);

  async function onDismissImportReport() {
    if (!file) return;
    if (
      !window.confirm(
        "永久删除这份 Markdown 导入报告？删除后所有人都不再看到。",
      )
    ) {
      return;
    }

    setDismissingReport(true);
    setError(null);

    try {
      await dismissImportWarnings(file.id);
      setFile({ ...file, importWarnings: null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除导入报告失败");
    } finally {
      setDismissingReport(false);
    }
  }

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
            <div className="content-viewer-heading">
              <div className="content-viewer-kicker">
                <span className="content-viewer-eyebrow">文档</span>
                {/* 已发布是文档的常态，标出来等于每篇都挂一个同样的标签，没有信息量。
                    只有草稿、已删除这类「读到的不是正式版本」才需要提醒。 */}
                {file.status === "published" ? null : (
                  <span
                    className="content-viewer-status"
                    data-status={file.status}
                  >
                    {fileStatusLabel(file.status)}
                  </span>
                )}
              </div>
              <div className="content-viewer-title">
                <h1>{file.title}</h1>
              </div>
            </div>
            <div className="content-viewer-actions">
              <details className="reader-settings">
                <summary aria-label="打开阅读设置" className="button secondary">
                  <ALargeSmall aria-hidden="true" className="button-icon" />
                  <span>阅读</span>
                </summary>
                <div className="reader-settings-popover">
                  <strong>阅读设置</strong>
                  <span className="reader-settings-label">字体</span>
                  <div className="reader-font-options">
                    {readerFontOptions.map((option) => (
                      <button
                        aria-pressed={readerFont === option.value}
                        key={option.value}
                        onClick={() => setReaderFont(option.value)}
                        type="button"
                      >
                        <span data-font={option.value}>{option.label}</span>
                        {readerFont === option.value ? (
                          <Check aria-hidden="true" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <span className="reader-settings-label">字号</span>
                  <div className="reader-size-control">
                    <button
                      aria-label="减小正文字号"
                      disabled={readerFontSize <= MIN_READER_FONT_SIZE}
                      onClick={() =>
                        setReaderFontSize((current) =>
                          Math.max(MIN_READER_FONT_SIZE, current - 1),
                        )
                      }
                      type="button"
                    >
                      <Minus aria-hidden="true" />
                    </button>
                    <span>{readerFontSize}px</span>
                    <button
                      aria-label="增大正文字号"
                      disabled={readerFontSize >= MAX_READER_FONT_SIZE}
                      onClick={() =>
                        setReaderFontSize((current) =>
                          Math.min(MAX_READER_FONT_SIZE, current + 1),
                        )
                      }
                      type="button"
                    >
                      <Plus aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </details>
              {canEditContent(file.permission) ? (
                <Link
                  aria-label="编辑"
                  className="button secondary content-viewer-edit-link"
                  href={contentEdit(fileId)}
                  title="编辑文档"
                >
                  <Edit3 aria-hidden="true" className="button-icon" />
                  <span>编辑</span>
                </Link>
              ) : null}
            </div>
          </header>

          {/* 导入报告只对改得动文档的人有意义，纯读者看到也无从下手。 */}
          {canEditContent(file.permission) &&
          file.importWarnings &&
          file.importWarnings.length > 0 ? (
            <details className="content-import-report">
              <summary>
                Markdown 导入报告 · {file.importWarnings.length} 项需要注意
              </summary>
              <ul>
                {file.importWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <button
                className="content-import-report-dismiss"
                disabled={dismissingReport}
                onClick={() => void onDismissImportReport()}
                type="button"
              >
                {dismissingReport ? "删除中…" : "核对完毕，删除报告"}
              </button>
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
            <article
              className="content-viewer-document"
              data-reader-font={readerFont}
              style={
                {
                  "--reader-font-size": `${readerFontSize}px`,
                } as CSSProperties
              }
            >
              {blocks.length > 0 ? (
                blocks.map((block) => (
                  <div
                    className="content-viewer-block"
                    data-block-type={block.type}
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
