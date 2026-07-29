"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchFilePreview } from "@/lib/api";

export function AssetTextPreview({
  previewPath,
  markdown,
}: {
  previewPath: string;
  markdown: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setError("");
    void fetchFilePreview(previewPath, controller.signal)
      .then((response) => response.text())
      .then(setContent)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        setError(caught instanceof Error ? caught.message : "无法加载文件预览");
      });
    return () => controller.abort();
  }, [previewPath]);

  if (error) {
    return (
      <div className="asset-preview-status" role="alert">
        <strong>无法在线预览</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (content === null) {
    return (
      <div className="asset-preview-status" role="status">
        正在加载预览…
      </div>
    );
  }
  if (!markdown) {
    return <pre className="asset-preview-plain-text">{content}</pre>;
  }

  return (
    <article className="asset-preview-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="asset-preview-markdown-image">
              [图片：{alt || "未命名"}]
            </span>
          ),
        }}
      >
        {content}
      </Markdown>
    </article>
  );
}
