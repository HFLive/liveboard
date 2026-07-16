"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ForumImageSummary } from "@liveboard/shared";
import { apiResourceUrl } from "@/lib/api";

export function ForumPostImages({
  images,
  compact = false,
}: {
  images: ForumImageSummary[];
  compact?: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selectedImage =
    selectedIndex === null ? null : (images[selectedIndex] ?? null);
  const activeIndex = selectedIndex ?? 0;

  useEffect(() => {
    if (selectedIndex === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedIndex(null);
      if (event.key === "ArrowLeft") {
        setSelectedIndex((current) =>
          current === null
            ? null
            : (current - 1 + images.length) % images.length,
        );
      }
      if (event.key === "ArrowRight") {
        setSelectedIndex((current) =>
          current === null ? null : (current + 1) % images.length,
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [images.length, selectedIndex]);

  if (images.length === 0) return null;

  const lightbox = selectedImage ? (
    <div
      aria-label="图片预览"
      aria-modal="true"
      className="forum-image-lightbox"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setSelectedIndex(null);
      }}
      role="dialog"
    >
      <button
        aria-label="关闭大图"
        className="forum-lightbox-close"
        onClick={() => setSelectedIndex(null)}
        type="button"
      >
        <X aria-hidden="true" />
      </button>
      {images.length > 1 ? (
        <button
          aria-label="上一张"
          className="forum-lightbox-nav previous"
          onClick={() =>
            setSelectedIndex((activeIndex - 1 + images.length) % images.length)
          }
          type="button"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
      ) : null}
      <img
        alt={`帖子大图 ${activeIndex + 1}`}
        height={selectedImage.height}
        src={apiResourceUrl(selectedImage.url)}
        width={selectedImage.width}
      />
      {images.length > 1 ? (
        <>
          <button
            aria-label="下一张"
            className="forum-lightbox-nav next"
            onClick={() => setSelectedIndex((activeIndex + 1) % images.length)}
            type="button"
          >
            <ChevronRight aria-hidden="true" />
          </button>
          <span className="forum-lightbox-count">
            {activeIndex + 1}/{images.length}
          </span>
        </>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <div
        className={`forum-post-images${compact ? " compact" : ""}`}
        data-count={images.length}
      >
        {images.map((image, index) => (
          <button
            aria-label={`展开第 ${index + 1} 张图片`}
            key={image.id}
            onClick={() => setSelectedIndex(index)}
            type="button"
          >
            <img
              alt={`帖子图片 ${index + 1}`}
              height={image.height}
              loading="lazy"
              src={apiResourceUrl(image.url)}
              width={image.width}
            />
          </button>
        ))}
      </div>
      {lightbox && typeof document !== "undefined"
        ? createPortal(lightbox, document.body)
        : null}
    </>
  );
}
