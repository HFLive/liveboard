"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Folder, Search, X } from "lucide-react";
import type { FolderNode } from "@liveboard/shared";

type FolderLocation = {
  folder: FolderNode;
  path: FolderNode[];
  label: string;
};

function indexFolders(
  folders: FolderNode[],
  parents: FolderNode[] = [],
  excludedFolderId?: string,
): FolderLocation[] {
  return folders.flatMap((folder) => {
    if (folder.id === excludedFolderId) return [];
    const path = [...parents, folder];
    return [
      { folder, path, label: path.map((item) => item.name).join(" / ") },
      ...indexFolders(folder.children, path, excludedFolderId),
    ];
  });
}

export function FolderLocationPicker({
  folders,
  value,
  disabled,
  onChange,
  label = "创建位置",
  excludedFolderId,
  autoFocus = false,
}: {
  folders: FolderNode[];
  value: string;
  disabled: boolean;
  onChange: (folderId: string) => void;
  label?: string;
  excludedFolderId?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const currentCrumbRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previousValueRef = useRef(value);
  const locations = useMemo(
    () => indexFolders(folders, [], excludedFolderId),
    [excludedFolderId, folders],
  );
  const byId = useMemo(
    () => new Map(locations.map((location) => [location.folder.id, location])),
    [locations],
  );
  const current = byId.get(value);
  const searchTerms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const searching = searchTerms.length > 0;
  const visibleLocations = (
    searching
      ? locations.filter((location) =>
          searchTerms.every((term) =>
            location.label.toLocaleLowerCase().includes(term),
          ),
        )
      : (current?.folder.children ?? folders).flatMap((folder) => {
          const location = byId.get(folder.id);
          return location ? [location] : [];
        })
  ).sort((left, right) =>
    left.folder.name.localeCompare(right.folder.name, "zh-CN"),
  );

  useEffect(() => {
    if (previousValueRef.current !== value) {
      previousValueRef.current = value;
      currentCrumbRef.current?.focus({ preventScroll: true });
      if (listRef.current) listRef.current.scrollTop = 0;
    }
  }, [value]);

  function chooseLocation(folderId: string) {
    setQuery("");
    if (folderId === value) {
      currentCrumbRef.current?.focus({ preventScroll: true });
      if (listRef.current) listRef.current.scrollTop = 0;
    }
    onChange(folderId);
  }

  return (
    <fieldset className="folder-destination-picker" disabled={disabled}>
      <legend>{label}</legend>
      <div className="folder-destination-search">
        <Search aria-hidden="true" />
        <input
          aria-label={`搜索${label}`}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // 搜索回车不提交外层的创建或移动表单。
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder="搜索文件夹"
          ref={searchRef}
          type="search"
          value={query}
        />
        {query ? (
          <button
            aria-label="清除文件夹搜索"
            className="folder-destination-icon"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <nav aria-label={`${label}路径`} className="folder-destination-path">
        {current ? (
          <button
            aria-label="返回上级文件夹"
            className="folder-destination-icon"
            onClick={() => chooseLocation(current.folder.parentId ?? "")}
            type="button"
          >
            <ArrowLeft aria-hidden="true" />
          </button>
        ) : null}
        <ol>
          <li>
            <button
              aria-current={!value ? "location" : undefined}
              onClick={() => chooseLocation("")}
              ref={!value ? currentCrumbRef : undefined}
              type="button"
            >
              顶层
            </button>
          </li>
          {current && current.path.length > 1 ? (
            <li
              aria-label={`上级路径：${current.path
                .slice(0, -1)
                .map((folder) => folder.name)
                .join(" / ")}`}
              className="folder-destination-omitted"
              title={current.path
                .slice(0, -1)
                .map((folder) => folder.name)
                .join(" / ")}
            >
              <ChevronRight aria-hidden="true" />
              <span>…</span>
            </li>
          ) : null}
          {current ? (
            <li className="folder-destination-current">
              <ChevronRight aria-hidden="true" />
              <button
                aria-current="location"
                onClick={() => chooseLocation(current.folder.id)}
                ref={currentCrumbRef}
                title={current.label}
                type="button"
              >
                {current.folder.name}
              </button>
            </li>
          ) : null}
        </ol>
      </nav>
      <ul
        aria-label={searching ? "文件夹搜索结果" : "子文件夹"}
        className="folder-destination-list"
        ref={listRef}
      >
        {visibleLocations.map(({ folder, label, path }) => (
          <li key={folder.id}>
            <button
              aria-label={`选择“${label}”`}
              onClick={() => chooseLocation(folder.id)}
              title={label}
              type="button"
            >
              <Folder
                aria-hidden="true"
                className="folder-destination-folder"
              />
              <span className="folder-destination-name">
                <span>{folder.name}</span>
                {searching ? (
                  <small>
                    {path
                      .slice(0, -1)
                      .map((item) => item.name)
                      .join(" / ") || "顶层"}
                  </small>
                ) : null}
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          </li>
        ))}
        {visibleLocations.length === 0 ? (
          <li className="folder-destination-empty" role="status">
            {searching ? "没有匹配的文件夹" : "此位置下没有子文件夹"}
          </li>
        ) : null}
      </ul>
    </fieldset>
  );
}

export function FolderLocationSummary({
  label,
  path,
  unavailableReason,
}: {
  label: string;
  path: string;
  unavailableReason?: string | null;
}) {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="folder-destination-summary"
    >
      <Folder aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{path}</strong>
        {unavailableReason ? (
          <span className="folder-destination-unavailable">
            {unavailableReason}
          </span>
        ) : null}
      </div>
    </div>
  );
}
