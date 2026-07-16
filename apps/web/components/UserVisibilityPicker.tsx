"use client";

import { Search } from "lucide-react";
import type { UserSummary } from "@liveboard/shared";
import styles from "./UserVisibilityPicker.module.css";

interface UserVisibilityPickerProps {
  users: UserSummary[];
  selectedUserIds: Set<string>;
  creatorUserId: string;
  onChange: (selectedUserIds: Set<string>) => void;
  disabled?: boolean;
  query: string;
  onQueryChange: (query: string) => void;
}

export function UserVisibilityPicker({
  users,
  selectedUserIds,
  creatorUserId,
  onChange,
  disabled = false,
  query,
  onQueryChange,
}: UserVisibilityPickerProps) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredUsers = users.filter((user) =>
    normalizedQuery
      ? `${user.displayName} ${user.username}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      : true,
  );
  const allSelected = users.every((user) => selectedUserIds.has(user.id));

  function toggleUser(userId: string) {
    if (disabled || userId === creatorUserId) return;
    const next = new Set(selectedUserIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    next.add(creatorUserId);
    onChange(next);
  }

  function toggleAll() {
    if (disabled) return;
    onChange(
      allSelected
        ? new Set([creatorUserId])
        : new Set(users.map((user) => user.id)),
    );
  }

  return (
    <section className={styles.picker} aria-label="可见范围">
      <div className={styles.header}>
        <div>
          <strong>可见范围</strong>
          <span>已选择 {selectedUserIds.size} 人</span>
        </div>
        <button disabled={disabled} onClick={toggleAll} type="button">
          {allSelected ? "取消全选" : "全选"}
        </button>
      </div>
      <label className={styles.search}>
        <Search aria-hidden="true" />
        <input
          disabled={disabled}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索姓名或用户名"
          value={query}
        />
      </label>
      <div className={styles.users}>
        {filteredUsers.map((user) => {
          const isCreator = user.id === creatorUserId;
          return (
            <label className={styles.user} key={user.id}>
              <input
                checked={selectedUserIds.has(user.id)}
                disabled={disabled || isCreator}
                onChange={() => toggleUser(user.id)}
                type="checkbox"
              />
              <span>
                <strong>{user.displayName}</strong>
              </span>
              {isCreator ? <em>创建者</em> : null}
            </label>
          );
        })}
        {filteredUsers.length === 0 ? (
          <p className={styles.empty}>没有匹配的用户</p>
        ) : null}
      </div>
    </section>
  );
}
