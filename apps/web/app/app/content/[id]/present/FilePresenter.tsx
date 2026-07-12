"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  LayoutGrid,
  List,
} from "lucide-react";
import type { ContentBlock } from "@/lib/api";
import { type FileDetail, getFile, listBlocks } from "@/lib/api";
import { getBlockText, RenderBlockContent } from "../ContentBlockRenderer";
import { contentDetail } from "@/lib/routes";

interface Slide {
  id: string;
  title: string;
  blocks: ContentBlock[];
}

function buildSlides(fileTitle: string, blocks: ContentBlock[]): Slide[] {
  const slides: Slide[] = [];
  let current: Slide = { id: "intro", title: fileTitle, blocks: [] };

  for (const block of blocks) {
    const startsSlide =
      (block.type === "heading_1" || block.type === "heading_2") &&
      current.blocks.length > 0;

    if (startsSlide) {
      slides.push(current);
      current = {
        id: block.id,
        title: getBlockText(block) || fileTitle,
        blocks: [block],
      };
      continue;
    }

    if (
      current.blocks.length === 0 &&
      (block.type === "heading_1" || block.type === "heading_2")
    ) {
      current = {
        id: block.id,
        title: getBlockText(block) || fileTitle,
        blocks: [block],
      };
      continue;
    }

    current.blocks.push(block);
  }

  if (current.blocks.length > 0) {
    slides.push(current);
  }

  return slides.length > 0
    ? slides
    : [{ id: "empty", title: fileTitle, blocks: [] }];
}

export function FilePresenter({ fileId }: { fileId: string }) {
  const stageRef = useRef<HTMLElement | null>(null);
  const [file, setFile] = useState<FileDetail | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    Promise.all([getFile(fileId), listBlocks(fileId)])
      .then(([fileResult, blockResult]) => {
        setFile(fileResult.file);
        setBlocks(blockResult.blocks);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载授课内容失败");
      });
  }, [fileId]);

  const slides = useMemo(
    () => buildSlides(file?.title ?? "授课内容", blocks),
    [blocks, file?.title],
  );
  const activeSlide = slides[Math.min(activeIndex, slides.length - 1)];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a, button, input, textarea, select")) {
        return;
      }

      if (
        event.key === "Escape" &&
        isFocusMode &&
        !document.fullscreenElement
      ) {
        setIsFocusMode(false);
        return;
      }

      if (
        event.key === "ArrowRight" ||
        event.key === "PageDown" ||
        event.key === " "
      ) {
        event.preventDefault();
        setActiveIndex((current) => Math.min(current + 1, slides.length - 1));
      }

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
      }

      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
      }

      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(slides.length - 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFocusMode, slides.length]);

  useEffect(() => {
    function onFullscreenChange() {
      const fullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(fullscreen);
      if (!fullscreen) {
        setIsFocusMode(false);
      }
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, slides.length - 1));
  }, [slides.length]);

  function go(delta: number) {
    setActiveIndex((current) =>
      Math.max(0, Math.min(current + delta, slides.length - 1)),
    );
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement || isFocusMode) {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        setIsFocusMode(false);
      }
      return;
    }

    setIsFocusMode(true);

    try {
      await stageRef.current?.requestFullscreen();
    } catch {
      // The in-page focus mode remains available when native fullscreen is blocked.
    }
  }

  const presentationActive = isFullscreen || isFocusMode;

  return (
    <div className={`presenter-shell ${isFocusMode ? "focus-mode" : ""}`}>
      <header className="presenter-topbar">
        <div>
          <h1>{file?.title ?? "授课内容"}</h1>
          <span>
            {slides.length > 1
              ? `${Math.min(activeIndex + 1, slides.length)} / ${slides.length}`
              : "演示预览"}
          </span>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={contentDetail(fileId)}>
            <ArrowLeft aria-hidden="true" className="button-icon" />
            返回编辑
          </Link>
          {slides.length > 1 ? (
            <button
              className="button secondary"
              onClick={() => setShowOverview((current) => !current)}
              type="button"
            >
              {showOverview ? (
                <List aria-hidden="true" className="button-icon" />
              ) : (
                <LayoutGrid aria-hidden="true" className="button-icon" />
              )}
              {showOverview ? "返回单页" : "页面总览"}
            </button>
          ) : null}
          <button
            className="button secondary"
            onClick={() => void toggleFullscreen()}
            type="button"
          >
            {presentationActive ? (
              <Minimize2 aria-hidden="true" className="button-icon" />
            ) : (
              <Maximize2 aria-hidden="true" className="button-icon" />
            )}
            {presentationActive ? "退出全屏" : "课件全屏"}
          </button>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <section
        className={`presenter-layout ${
          slides.length === 1 ? "single-slide" : ""
        } ${showOverview ? "overview-mode" : ""}`}
      >
        {slides.length > 1 ? (
          <aside className="presenter-outline" aria-label="幻灯片目录">
            {slides.map((slide, index) => (
              <button
                className={index === activeIndex ? "active" : ""}
                key={slide.id}
                onClick={() => setActiveIndex(index)}
                type="button"
              >
                <span>{index + 1}</span>
                <strong>{slide.title}</strong>
              </button>
            ))}
          </aside>
        ) : null}

        <section
          className="presenter-stage"
          ref={stageRef}
          aria-label="演示画布"
        >
          <div className="presenter-stage-toolbar">
            <span>{activeSlide?.title ?? file?.title ?? "授课内容"}</span>
            <small>方向键或空格翻页</small>
            <button
              className="presenter-stage-fullscreen-toggle"
              onClick={() => void toggleFullscreen()}
              type="button"
            >
              <Minimize2 aria-hidden="true" />
              退出全屏
            </button>
          </div>

          {showOverview ? (
            <div className="presenter-overview" aria-label="课件页面总览">
              {slides.map((slide, index) => (
                <button
                  className={index === activeIndex ? "active" : ""}
                  key={slide.id}
                  onClick={() => {
                    setActiveIndex(index);
                    setShowOverview(false);
                  }}
                  type="button"
                >
                  <span>{index + 1}</span>
                  <strong>{slide.title}</strong>
                  <small>{slide.blocks.length} 个内容块</small>
                </button>
              ))}
            </div>
          ) : (
            <article className="presenter-slide">
              {activeSlide?.blocks.length ? (
                <>
                  {activeSlide.blocks[0]?.type !== "heading_1" &&
                  activeSlide.blocks[0]?.type !== "heading_2" ? (
                    <h2 className="presenter-slide-title">
                      {activeSlide.title}
                    </h2>
                  ) : null}
                  {activeSlide.blocks.map((block) => (
                    <RenderBlockContent block={block} key={block.id} />
                  ))}
                </>
              ) : (
                <div className="empty-state">这个文件还没有可呈现的内容。</div>
              )}
            </article>
          )}

          {slides.length > 1 && !showOverview ? (
            <div className="presenter-controls">
              <button
                className="button secondary"
                disabled={activeIndex === 0}
                onClick={() => go(-1)}
                type="button"
              >
                <ChevronLeft aria-hidden="true" className="button-icon" />
                上一页
              </button>
              <div className="presenter-progress" aria-label="授课进度">
                <span
                  style={{
                    width: `${((activeIndex + 1) / slides.length) * 100}%`,
                  }}
                />
              </div>
              <span className="presenter-page-number">
                {activeIndex + 1} / {slides.length}
              </span>
              <button
                className="button"
                disabled={activeIndex >= slides.length - 1}
                onClick={() => go(1)}
                type="button"
              >
                下一页
                <ChevronRight
                  aria-hidden="true"
                  className="button-icon right"
                />
              </button>
            </div>
          ) : null}
        </section>
      </section>
    </div>
  );
}
