"use client";

import {
  forwardRef,
  TextareaHTMLAttributes,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

type AutoTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * 自适应高度的多行输入框：高度随内容增长，不允许用户手动拖拽改变高度。
 * 以初始渲染高度为最小高度，CSS max-height 作为上限，超出上限时出现滚动条。
 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  function AutoTextarea({ style, value, ...props }, forwardedRef) {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    const minHeightRef = useRef<number | null>(null);

    useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement);

    useLayoutEffect(() => {
      const element = ref.current;
      if (!element) return;

      minHeightRef.current ??= element.clientHeight;

      const cssMaxHeight = parseFloat(getComputedStyle(element).maxHeight);
      element.style.height = "auto";
      const wanted = Math.max(element.scrollHeight, minHeightRef.current);
      const capped =
        Number.isFinite(cssMaxHeight) && cssMaxHeight > 0
          ? Math.min(wanted, cssMaxHeight)
          : wanted;

      element.style.height = `${capped}px`;
      element.style.overflowY = wanted > capped ? "auto" : "hidden";
    }, [value]);

    return (
      <textarea
        ref={ref}
        style={{ resize: "none", ...style }}
        value={value}
        {...props}
      />
    );
  },
);
