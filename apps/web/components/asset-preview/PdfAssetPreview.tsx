"use client";

import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { ApiError, apiResourceUrl, fetchPreviewUrl } from "@/lib/api";

let pdfModulePromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfModule() {
  pdfModulePromise ??= import("pdfjs-dist").then((pdfjs) => {
    // PDF.js worker 由站点自身提供（public/ 下，Vercel 原生 application/javascript），
    // 不放进 EdgeOne 的 /_next/static：EdgeOne 上传对 .mjs 存成 octet-stream，而
    // 用 new URL() 输出 .js 又会被 webpack 编译出无法解析的 @swc/helpers 裸导入。
    // 文件名带 pdfjs 版本号，升级 pdfjs-dist 时换新 URL 并同步更新这里与
    // public/pdf.worker.<版本>.js。
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.v6.1.200.js";
    return pdfjs;
  });
  return pdfModulePromise;
}

type Progress = { loaded: number; total: number | undefined };

export function PdfAssetPreview({ previewPath }: { previewPath: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setDocument(null);
    setPageNumber(1);
    setZoom(1);
    setError("");
    setProgress(null);

    // 直传端点是与 /preview 平级的 /preview-url，对文档附件与课堂文件路径都成立。
    const previewUrlPath = previewPath.replace(/\/preview$/, "/preview-url");

    async function openDocument(
      pdfjs: typeof import("pdfjs-dist"),
      directUrl: string | null,
      attempt: number,
    ) {
      if (disposed) return;
      // 直传：预签名 URL 自身即鉴权，无需携带 cookie；回退代理需要会话 cookie。
      const source = directUrl
        ? { url: directUrl, withCredentials: false }
        : { url: apiResourceUrl(previewPath), withCredentials: true };
      const loadingTask = pdfjs.getDocument({
        ...source,
        enableXfa: false,
        maxImageSize: 24_000_000,
        // 只按需拉取当前页数据，配合 Range 请求实现「首帧即渲染、翻页再取」。
        disableAutoFetch: true,
        rangeChunkSize: 256 * 1024,
      });
      loadingTask.onProgress = (p: { loaded: number; total?: number }) => {
        if (disposed) return;
        setProgress({ loaded: p.loaded, total: p.total });
      };
      loadingTaskRef.current = loadingTask;
      try {
        const nextDocument = await loadingTask.promise;
        if (!nextDocument || disposed) return;
        setDocument(nextDocument);
        setProgress(null);
      } catch (caught) {
        if (
          disposed ||
          (caught instanceof DOMException && caught.name === "AbortError")
        ) {
          return;
        }
        // 直传依赖对象存储的 CORS（放行 Range 并暴露响应头）；未配好时浏览器
        // fetch 会以网络错误失败。任何直传失败都回退一次到服务器中转（同源或
        // 带 cookie，必定可达），避免预览在未配 CORS 的 direct 模式下挂掉。
        if (directUrl && attempt === 0) {
          await openDocument(pdfjs, null, 1);
          return;
        }
        throw caught;
      }
    }

    void (async () => {
      let pdfjs: typeof import("pdfjs-dist");
      try {
        pdfjs = await loadPdfModule();
      } catch (caught) {
        if (!disposed) throw caught;
        return;
      }
      if (disposed) return;
      let directUrl: string | null = null;
      try {
        directUrl = (await fetchPreviewUrl(previewUrlPath, controller.signal))
          .url;
      } catch (caught) {
        if (
          disposed ||
          (caught instanceof DOMException && caught.name === "AbortError")
        ) {
          return;
        }
        // 鉴权/无权限错误保留原始文案；其余失败（旧后端缺 /preview-url 路由、
        // 瞬时错误）回退代理，不让预览因探测请求失败而整体中断。
        if (
          caught instanceof ApiError &&
          (caught.status === 401 || caught.status === 403)
        ) {
          throw caught;
        }
      }
      if (disposed) return;
      await openDocument(pdfjs, directUrl, 0);
    })().catch((caught: unknown) => {
      if (
        disposed ||
        (caught instanceof DOMException && caught.name === "AbortError")
      ) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "无法解析 PDF");
    });

    return () => {
      disposed = true;
      controller.abort();
      renderTaskRef.current?.cancel();
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
    };
  }, [previewPath]);

  // 页码输入框与当前页保持同步；用户输入时依赖不触发，避免一边打字一边被覆盖。
  useEffect(() => {
    setPageDraft(String(pageNumber));
  }, [pageNumber]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => setViewportWidth(viewport.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!document || !canvas || viewportWidth <= 0) return;
    let disposed = false;
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (disposed) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.min(
          1.5,
          Math.max(0.25, (viewportWidth - 28) / baseViewport.width),
        );
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法创建 PDF 画布");
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTaskRef.current?.cancel();
        const task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        renderTaskRef.current = task;
        return task.promise;
      })
      .catch((caught: unknown) => {
        if (
          disposed ||
          (caught instanceof Error &&
            caught.name === "RenderingCancelledException")
        ) {
          return;
        }
        setError(caught instanceof Error ? caught.message : "无法渲染 PDF");
      });
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
    };
  }, [document, pageNumber, viewportWidth, zoom]);

  function commitPage(value: string) {
    if (!document) return;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      setPageDraft(String(pageNumber));
      return;
    }
    setPageNumber(Math.max(1, Math.min(document.numPages, parsed)));
  }

  if (error) {
    return (
      <div className="asset-preview-status" role="alert">
        <strong>无法在线预览</strong>
        <span>{error}</span>
      </div>
    );
  }

  // total 未知（按需加载的 Range 模式）时进度条走不定进度动画。
  const progressPercent = progress?.total
    ? Math.min(100, (progress.loaded / progress.total) * 100)
    : null;

  return (
    <div className="asset-preview-pdf">
      <div className="asset-preview-pdf-toolbar">
        <button
          aria-label="上一页"
          disabled={!document || pageNumber <= 1}
          onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
          type="button"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <div className="asset-preview-pdf-page">
          <input
            aria-label="跳转到页码"
            disabled={!document}
            max={document?.numPages ?? 1}
            min={1}
            onChange={(event) => setPageDraft(event.target.value)}
            // 只有回车才提交；blur 丢弃未提交的输入，否则先失焦提交再点下一页
            // 会让翻页基于刚跳转的页码计算，导致下一页按钮看似失灵。
            onBlur={() => setPageDraft(String(pageNumber))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitPage((event.target as HTMLInputElement).value);
                (event.target as HTMLInputElement).blur();
              }
            }}
            type="number"
            value={pageDraft}
          />
          <span>/ {document?.numPages ?? "…"}</span>
        </div>
        <button
          aria-label="下一页"
          disabled={!document || pageNumber >= document.numPages}
          onClick={() =>
            setPageNumber((page) =>
              document ? Math.min(document.numPages, page + 1) : page,
            )
          }
          type="button"
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <i aria-hidden="true" />
        <button
          aria-label="缩小"
          disabled={!document || zoom <= 0.7}
          onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))}
          type="button"
        >
          <ZoomOut aria-hidden="true" />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="放大"
          disabled={!document || zoom >= 2}
          onClick={() => setZoom((value) => Math.min(2, value + 0.1))}
          type="button"
        >
          <ZoomIn aria-hidden="true" />
        </button>
      </div>
      {!document && progress ? (
        <div
          aria-label="正在加载 PDF"
          aria-valuemax={progress.total ?? 100}
          aria-valuemin={0}
          aria-valuenow={progress.total ? progress.loaded : undefined}
          className="asset-preview-pdf-progress"
          role="progressbar"
        >
          <i
            className={progressPercent === null ? "indeterminate" : undefined}
            style={
              progressPercent === null
                ? undefined
                : { width: `${progressPercent}%` }
            }
          />
        </div>
      ) : null}
      <div className="asset-preview-pdf-viewport" ref={viewportRef}>
        <canvas aria-label={`PDF 第 ${pageNumber} 页`} ref={canvasRef} />
      </div>
    </div>
  );
}
