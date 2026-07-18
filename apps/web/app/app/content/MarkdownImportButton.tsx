"use client";

import { ChangeEvent, useRef, useState } from "react";
import { Download } from "lucide-react";

export function MarkdownImportButton({
  disabled = false,
  menuItem = false,
  onImport,
}: {
  disabled?: boolean;
  /** 在“新建”下拉菜单中作为菜单项渲染。 */
  menuItem?: boolean;
  onImport: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImporting(true);
    try {
      await onImport(file);
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        accept=".md,text/markdown,text/plain"
        aria-label="选择 Markdown 文件"
        className="visually-hidden-input"
        disabled={disabled || importing}
        onChange={(event) => void handleFile(event)}
        type="file"
      />
      <button
        className={menuItem ? undefined : "button secondary"}
        disabled={disabled || importing}
        onClick={() => inputRef.current?.click()}
        role={menuItem ? "menuitem" : undefined}
        type="button"
      >
        <Download aria-hidden="true" className="button-icon" />
        {importing ? "导入中" : "导入 Markdown"}
      </button>
    </>
  );
}
