"use client";

import styles from "./DocumentImageViewer.module.css";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCw, Scan, X, ZoomIn, ZoomOut } from "lucide-react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function DocumentImageViewer({
  alt,
  src,
  widthPercent,
}: {
  alt: string;
  src: string;
  widthPercent: number;
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      } else if (event.key === "+" || event.key === "=") {
        setZoom((current) => clampZoom(current + ZOOM_STEP));
      } else if (event.key === "-") {
        setZoom((current) => clampZoom(current - ZOOM_STEP));
      } else if (event.key.toLowerCase() === "r") {
        setRotation((current) => current + 90);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openViewer() {
    setZoom(1);
    setRotation(0);
    setOpen(true);
  }

  const viewer =
    open && typeof document !== "undefined" ? (
      <div
        className={styles.backdrop}
        onClick={(event) => {
          if (event.currentTarget === event.target) setOpen(false);
        }}
        role="presentation"
      >
        <div
          aria-label={`查看大图：${alt}`}
          aria-modal="true"
          className={styles.dialog}
          role="dialog"
        >
          <div className={styles.toolbar}>
            <span className={styles.title} title={alt}>
              {alt}
            </span>
            <div className={styles.controls}>
              <button
                aria-label="缩小图片"
                disabled={zoom <= MIN_ZOOM}
                onClick={() =>
                  setZoom((current) => clampZoom(current - ZOOM_STEP))
                }
                type="button"
              >
                <ZoomOut aria-hidden="true" />
              </button>
              <output aria-label="当前缩放比例">
                {Math.round(zoom * 100)}%
              </output>
              <button
                aria-label="放大图片"
                disabled={zoom >= MAX_ZOOM}
                onClick={() =>
                  setZoom((current) => clampZoom(current + ZOOM_STEP))
                }
                type="button"
              >
                <ZoomIn aria-hidden="true" />
              </button>
              <button
                aria-label="顺时针旋转图片"
                onClick={() => setRotation((current) => current + 90)}
                type="button"
              >
                <RotateCw aria-hidden="true" />
              </button>
              <button
                aria-label="还原图片"
                disabled={zoom === 1 && rotation % 360 === 0}
                onClick={() => {
                  setZoom(1);
                  setRotation(0);
                }}
                type="button"
              >
                <Scan aria-hidden="true" />
              </button>
              <button
                aria-label="关闭大图"
                autoFocus
                onClick={() => setOpen(false)}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className={styles.viewport}>
            <div className={styles.stage}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={alt}
                className={styles.image}
                draggable={false}
                src={src}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt}
        className="render-image render-image-expandable"
        onClick={openViewer}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openViewer();
          }
        }}
        role="button"
        src={src}
        style={{ width: `${widthPercent}%` }}
        tabIndex={0}
        title="点击查看大图"
      />
      {viewer ? createPortal(viewer, document.body) : null}
    </>
  );
}
