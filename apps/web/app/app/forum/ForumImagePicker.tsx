"use client";

import { useEffect, useId, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { compressImageFile } from "@/components/image-compress";

export const MAX_FORUM_IMAGES = 9;
const MAX_FORUM_IMAGE_EDGE = 1600;

interface ForumImagePickerProps {
  value: File[];
  onChange: (images: File[]) => void;
  onError: (message: string) => void;
  onProcessingChange?: (processing: boolean) => void;
  disabled?: boolean;
  maxImages?: number;
}

export function ForumImagePicker({
  value,
  onChange,
  onError,
  onProcessingChange,
  disabled = false,
  maxImages = MAX_FORUM_IMAGES,
}: ForumImagePickerProps) {
  const inputId = useId();
  const [previews, setPreviews] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const urls = value.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [value]);

  async function selectImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);
    if (value.length + selected.length > maxImages) {
      onError(`最多附带 ${maxImages} 张图片`);
      return;
    }

    setProcessing(true);
    onProcessingChange?.(true);
    try {
      const compressed = await Promise.all(
        selected.map((file, index) => compressForumImage(file, index)),
      );
      onChange([...value, ...compressed]);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "图片处理失败");
    } finally {
      setProcessing(false);
      onProcessingChange?.(false);
    }
  }

  return (
    <div className="forum-image-picker">
      {value.length > 0 ? (
        <div className="forum-image-preview-grid">
          {value.map((file, index) => (
            <figure
              className="forum-image-preview"
              key={`${file.name}-${index}`}
            >
              <img alt={`待上传图片 ${index + 1}`} src={previews[index]} />
              <button
                aria-label={`移除第 ${index + 1} 张图片`}
                disabled={disabled || processing}
                onClick={() =>
                  onChange(value.filter((_, itemIndex) => itemIndex !== index))
                }
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </figure>
          ))}
        </div>
      ) : null}

      <div className="forum-image-picker-actions">
        <label className="forum-image-add" htmlFor={inputId}>
          <ImagePlus aria-hidden="true" />
          {processing ? "正在压缩" : "添加图片"}
        </label>
        <span>
          {value.length}/{maxImages}
        </span>
        <input
          accept="image/jpeg,image/png,image/webp,image/gif"
          disabled={disabled || processing || value.length >= maxImages}
          id={inputId}
          multiple
          onChange={(event) => {
            void selectImages(event.target.files);
            event.target.value = "";
          }}
          type="file"
        />
      </div>
    </div>
  );
}

export function compressForumImage(file: File, index: number) {
  return compressImageFile(file, {
    maxEdge: MAX_FORUM_IMAGE_EDGE,
    quality: 0.82,
    outputFileName: `forum-image-${Date.now()}-${index + 1}.webp`,
  });
}
