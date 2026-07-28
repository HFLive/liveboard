"use client";

import { useCallback, useRef, useState } from "react";

export interface FeedbackNoticeValue {
  id: number;
  text: string;
}

/**
 * 普通 string 状态连续写入相同文案时不会触发 React 更新，导致已经完成
 * 隐藏动画的全局通知无法再次出现。每次非空写入都生成新 id，确保提示节点重建。
 */
export function useFeedbackNotice() {
  const nextId = useRef(0);
  const [notice, setNotice] = useState<FeedbackNoticeValue | null>(null);

  const setFeedback = useCallback((text: string | null) => {
    if (text === null) {
      setNotice(null);
      return;
    }
    nextId.current += 1;
    setNotice({ id: nextId.current, text });
  }, []);

  return [notice, setFeedback] as const;
}

export function FeedbackNotice({
  notice,
  tone,
}: {
  notice: FeedbackNoticeValue | null;
  tone: "error" | "success";
}) {
  if (!notice) return null;

  return (
    <p
      className={tone === "error" ? "error-text" : "success-text"}
      key={notice.id}
    >
      {notice.text}
    </p>
  );
}
