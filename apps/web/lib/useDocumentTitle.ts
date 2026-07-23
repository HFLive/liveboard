"use client";

import { useEffect } from "react";

/** 在客户端详情页按内容设置浏览器标签标题（“标题 · LiveBoard”）。 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) {
      return;
    }

    const previous = document.title;
    const assigned = `${title} · LiveBoard`;
    document.title = assigned;

    return () => {
      if (document.title === assigned) {
        document.title = previous;
      }
    };
  }, [title]);
}
