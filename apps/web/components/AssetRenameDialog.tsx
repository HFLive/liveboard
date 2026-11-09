"use client";

import { type FormEvent, useId, useState } from "react";
import type { FolderAssetSummary } from "@liveboard/shared";
import {
  getResourceNameError,
  MAX_RESOURCE_NAME_LENGTH,
  normalizeResourceName,
} from "@liveboard/shared/resource-name";
import { X } from "lucide-react";
import { renameAsset } from "@/lib/api";

type RenamedAsset = Pick<FolderAssetSummary, "id" | "filename" | "updatedAt">;

export function AssetRenameDialog({
  asset,
  label = "文件",
  onClose,
  onError,
  onRenamed,
}: {
  asset: Pick<RenamedAsset, "id" | "filename">;
  label?: "文件" | "图片";
  onClose: () => void;
  onError: (message: string | null) => void;
  onRenamed: (asset: RenamedAsset) => void;
}) {
  const titleId = useId();
  const [filename, setFilename] = useState(asset.filename);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const nameError = getResourceNameError(filename, `${label}名称`);
    if (nameError) {
      onError(nameError);
      return;
    }

    setSaving(true);
    onError(null);
    try {
      const result = await renameAsset(
        asset.id,
        normalizeResourceName(filename),
      );
      onRenamed(result.asset);
      onClose();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : `重命名${label}失败`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-panel"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          if (!saving) onClose();
        }}
        onSubmit={onSubmit}
        role="dialog"
      >
        <div className="modal-head">
          <h2 id={titleId}>重命名{label}</h2>
          <button
            aria-label={`关闭重命名${label}`}
            className="icon-button subtle"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">
          <label className="label">
            {label}名称
            <input
              autoFocus
              className="input"
              maxLength={MAX_RESOURCE_NAME_LENGTH}
              onChange={(event) => setFilename(event.target.value)}
              readOnly={saving}
              value={filename}
            />
          </label>
        </div>
        <div className="modal-foot">
          <div className="button-row">
            <button
              className="button secondary"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="button" disabled={saving} type="submit">
              {saving ? "正在保存…" : "保存名称"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
