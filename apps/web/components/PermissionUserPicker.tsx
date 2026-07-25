"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { UserSummary, UserTagSummary } from "@liveboard/shared";
import styles from "./PermissionUserPicker.module.css";

interface PermissionUserPickerProps {
  users: UserSummary[];
  tags: UserTagSummary[];
  excludedUserIds: Set<string>;
  selectedUserId: string;
  onChange: (userId: string) => void;
}

export function PermissionUserPicker({
  users,
  tags,
  excludedUserIds,
  selectedUserId,
  onChange,
}: PermissionUserPickerProps) {
  const [query, setQuery] = useState("");
  const [tagId, setTagId] = useState("all");
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return users.filter(
      (user) =>
        !excludedUserIds.has(user.id) &&
        (tagId === "all" || user.tags?.some((tag) => tag.id === tagId)) &&
        (!normalizedQuery ||
          `${user.displayName} ${user.username}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)),
    );
  }, [excludedUserIds, query, tagId, users]);

  return (
    <div className={styles.picker}>
      <div className={styles.filters}>
        <label className={styles.search}>
          <Search aria-hidden="true" />
          <input
            aria-label="搜索成员"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索姓名或用户名"
            value={query}
          />
        </label>
        <select
          aria-label="按成员标签筛选"
          onChange={(event) => setTagId(event.target.value)}
          value={tagId}
        >
          <option value="all">全部标签</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.users}>
        {filteredUsers.map((user) => (
          <button
            aria-pressed={selectedUserId === user.id}
            className={selectedUserId === user.id ? styles.selected : undefined}
            key={user.id}
            onClick={() => onChange(user.id)}
            type="button"
          >
            <span>
              <strong>{user.displayName}</strong>
              <small>@{user.username}</small>
            </span>
            {user.tags?.length ? (
              <em>{user.tags.map((tag) => tag.name).join(" · ")}</em>
            ) : null}
          </button>
        ))}
        {filteredUsers.length === 0 ? (
          <p>没有匹配且尚未设置例外的成员</p>
        ) : null}
      </div>
    </div>
  );
}
