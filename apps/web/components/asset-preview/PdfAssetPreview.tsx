"use client";

import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { fetchFilePreview } from "@/lib/api";

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

export function PdfAssetPreview({ previewPath }: { previewPath: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setDocument(null);
    setPageNumber(1);
    setZoom(1);
    setError("");

    void Promise.all([
      loadPdfModule(),
      fetchFilePreview(previewPath, controller.signal).then((response) =>
        response.arrayBuffer(),
      ),
    ])
      .then(([pdfjs, data]) => {
        if (disposed) return;
        const loadingTask = pdfjs.getDocument({
          data,
          enableXfa: false,
          maxImageSize: 24_000_000,
        });
        loadingTaskRef.current = loadingTask;
        return loadingTask.promise;
      })
      .then((nextDocument) => {
        if (!nextDocument || disposed) return;
        setDocument(nextDocument);
      })
      .catch((caught: unknown) => {
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

  if (error) {
    return (
      <div className="asset-preview-status" role="alert">
        <strong>无法在线预览</strong>
        <span>{error}</span>
      </div>
    );
  }

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
        <span>
          {document ? `${pageNumber} / ${document.numPages}` : "正在加载…"}
        </span>
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
      <div className="asset-preview-pdf-viewport" ref={viewportRef}>
        <canvas aria-label={`PDF 第 ${pageNumber} 页`} ref={canvasRef} />
      </div>
    </div>
  );
}
