"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import {
  CropCorner,
  CropFrame,
  initialCropFrame,
  moveCropFrame,
  renderCroppedImageFile,
  resizeCropFrame,
} from "./imageCrop";
import styles from "./ImageCropDialog.module.css";

type ImageCropDialogProps = {
  title: string;
  sourceUrl: string;
  /** 输出宽高比（宽 / 高），头像为 1，Banner 由个人主页配置提供。 */
  aspect: number;
  outputWidth: number;
  outputHeight: number;
  outputFileName: string;
  confirmLabel: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => void;
};

type DragState = {
  kind: "move" | "resize";
  corner?: CropCorner;
  startClientX: number;
  startClientY: number;
  stageLeft: number;
  stageTop: number;
  startFrame: CropFrame;
};

const CORNERS: CropCorner[] = ["nw", "ne", "sw", "se"];

export function ImageCropDialog({
  title,
  sourceUrl,
  aspect,
  outputWidth,
  outputHeight,
  outputFileName,
  confirmLabel,
  saving,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const [frame, setFrame] = useState<CropFrame | null>(null);
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // 拖拽过程数据放在 ref 中，配合 window 级 pointermove/pointerup 监听，
  // 与 react-image-crop 的实现一致，避免依赖 React 闭包和 pointer capture。
  const dragRef = useRef<DragState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  function onImageLoad() {
    const image = imageRef.current;

    if (!image) return;

    const width = image.clientWidth;
    const height = image.clientHeight;
    setImageSize({ width, height });
    setFrame(initialCropFrame(width, height, aspect));
  }

  function onStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!frame || !imageSize || saving) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const handle = target.closest("[data-crop-handle]");
    const isFrame = target.closest("[data-crop-frame]");
    if (!handle && !isFrame) return;

    event.preventDefault();

    const stageRect = event.currentTarget.getBoundingClientRect();
    const drag: DragState = {
      kind: handle ? "resize" : "move",
      corner: (handle?.getAttribute("data-crop-handle") ?? undefined) as
        CropCorner | undefined,
      startClientX: event.clientX,
      startClientY: event.clientY,
      stageLeft: stageRect.left,
      stageTop: stageRect.top,
      startFrame: frame,
    };
    dragRef.current = drag;

    function onWindowPointerMove(moveEvent: globalThis.PointerEvent) {
      const activeDrag = dragRef.current;
      if (!activeDrag) return;

      if (activeDrag.kind === "move") {
        setFrame(
          moveCropFrame(
            activeDrag.startFrame,
            moveEvent.clientX - activeDrag.startClientX,
            moveEvent.clientY - activeDrag.startClientY,
            imageSize!.width,
            imageSize!.height,
            aspect,
          ),
        );
      } else if (activeDrag.corner) {
        setFrame(
          resizeCropFrame(
            activeDrag.startFrame,
            activeDrag.corner,
            moveEvent.clientX - activeDrag.stageLeft,
            moveEvent.clientY - activeDrag.stageTop,
            imageSize!.width,
            imageSize!.height,
            aspect,
          ),
        );
      }
    }

    function onWindowPointerUp() {
      dragRef.current = null;
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    }

    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
    };

    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
  }

  async function onConfirmClick() {
    const image = imageRef.current;

    if (!image || !frame || !imageSize) {
      setError("图片尚未加载完成");
      return;
    }

    setError(null);

    try {
      const file = await renderCroppedImageFile(
        image,
        frame,
        imageSize.width,
        outputWidth,
        outputHeight,
        outputFileName,
      );
      onConfirm(file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片处理失败");
    }
  }

  const frameHeight = frame ? frame.width / aspect : 0;

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        aria-modal="true"
        aria-label={title}
        className={`modal-panel ${styles.cropModal}`}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
          </div>
          <button
            aria-label="关闭"
            className="inline-icon-button"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className={`modal-body ${styles.cropBody}`}>
          <p className="muted">拖动选框调整位置，拖动四角调整大小。</p>
          <div className={styles.cropStage} onPointerDown={onStagePointerDown}>
            <img
              alt=""
              draggable={false}
              onLoad={onImageLoad}
              ref={imageRef}
              src={sourceUrl}
            />
            {frame && imageSize ? (
              <>
                <div
                  aria-hidden="true"
                  className={styles.cropDim}
                  style={{
                    left: 0,
                    top: 0,
                    width: imageSize.width,
                    height: frame.y,
                  }}
                />
                <div
                  aria-hidden="true"
                  className={styles.cropDim}
                  style={{
                    left: 0,
                    top: frame.y + frameHeight,
                    width: imageSize.width,
                    height: imageSize.height - frame.y - frameHeight,
                  }}
                />
                <div
                  aria-hidden="true"
                  className={styles.cropDim}
                  style={{
                    left: 0,
                    top: frame.y,
                    width: frame.x,
                    height: frameHeight,
                  }}
                />
                <div
                  aria-hidden="true"
                  className={styles.cropDim}
                  style={{
                    left: frame.x + frame.width,
                    top: frame.y,
                    width: imageSize.width - frame.x - frame.width,
                    height: frameHeight,
                  }}
                />
                <div
                  aria-label="裁切选框"
                  className={styles.cropFrame}
                  data-crop-frame="true"
                  role="presentation"
                  style={{
                    left: frame.x,
                    top: frame.y,
                    width: frame.width,
                    height: frameHeight,
                  }}
                >
                  {CORNERS.map((corner) => (
                    <button
                      aria-label={`${corner === "nw" ? "左上" : corner === "ne" ? "右上" : corner === "sw" ? "左下" : "右下"}角调整裁切框`}
                      className={`${styles.cropHandle} ${styles[corner]}`}
                      data-crop-handle={corner}
                      key={corner}
                      tabIndex={-1}
                      type="button"
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <div className="modal-foot">
          <div className="button-row">
            <button
              className="button secondary"
              disabled={saving}
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button
              className="button"
              disabled={saving || !frame}
              onClick={() => void onConfirmClick()}
              type="button"
            >
              <Upload aria-hidden="true" className="button-icon" />
              {saving ? "上传中" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
