"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Database, Save } from "lucide-react";
import {
  listUserStorage,
  updateUserStorageQuota,
  type UserStorageSummary,
} from "@/lib/api";
import { roleLabel } from "@/lib/labels";
import { UserProfileLink } from "@/components/UserProfileLink";
import { AdminSubnav } from "@/components/admin/AdminSubnav";

export function StorageManagementClient() {
  const [items, setItems] = useState<UserStorageSummary[]>([]);
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<"usage-desc" | "usage-asc" | "name">(
    "usage-desc",
  );

  const totalUsedBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.storageUsedBytes, 0),
    [items],
  );
  const totalQuotaBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.storageQuotaBytes, 0),
    [items],
  );
  const sortedItems = useMemo(
    () =>
      [...items].sort((left, right) => {
        if (sort === "name") {
          return left.user.displayName.localeCompare(right.user.displayName);
        }
        const leftUsage = left.storageQuotaBytes
          ? left.storageUsedBytes / left.storageQuotaBytes
          : 1;
        const rightUsage = right.storageQuotaBytes
          ? right.storageUsedBytes / right.storageQuotaBytes
          : 1;
        return sort === "usage-asc"
          ? leftUsage - rightUsage
          : rightUsage - leftUsage;
      }),
    [items, sort],
  );

  async function load(preserveDrafts = false) {
    const result = await listUserStorage();
    setItems(result.users);
    setQuotaDrafts((current) =>
      Object.fromEntries(
        result.users.map((item) => [
          item.user.id,
          preserveDrafts
            ? (current[item.user.id] ??
              bytesToMegabytes(item.storageQuotaBytes).toString())
            : bytesToMegabytes(item.storageQuotaBytes).toString(),
        ]),
      ),
    );
  }

  useEffect(() => {
    load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载容量信息失败");
    });
  }, []);

  async function onSaveQuota(
    event: FormEvent<HTMLFormElement>,
    item: UserStorageSummary,
  ) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const draft = quotaDrafts[item.user.id] ?? "";
    const quotaMb = Number(draft);

    if (!Number.isFinite(quotaMb) || quotaMb < 0) {
      setError("容量上限必须是不小于 0 的数字");
      return;
    }

    const nextQuotaBytes = Math.round(quotaMb * 1024 * 1024);
    if (nextQuotaBytes < item.storageUsedBytes) {
      setError(
        `容量上限不能低于当前已用的 ${formatStorageSize(item.storageUsedBytes)}`,
      );
      return;
    }

    setSavingUserId(item.user.id);

    try {
      await updateUserStorageQuota(item.user.id, nextQuotaBytes);
      setMessage("容量上限已更新");
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存容量上限失败");
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">管理中心</p>
          <h1>容量管理</h1>
          <p className="muted">查看成员存储使用情况，并调整个人容量上限。</p>
        </div>
      </header>

      <AdminSubnav />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="metric-strip" aria-label="容量概览">
        <article className="metric">
          <span>总占用</span>
          <strong>{formatStorageSize(totalUsedBytes)}</strong>
        </article>
        <article className="metric">
          <span>总上限</span>
          <strong>{formatStorageSize(totalQuotaBytes)}</strong>
        </article>
        <article className="metric">
          <span>成员数</span>
          <strong>{items.length}</strong>
        </article>
      </section>

      <section className="workbench-main">
        <div className="panel-head">
          <div>
            <h2>
              <Database aria-hidden="true" className="heading-icon" />
              用户容量
            </h2>
          </div>
          <select
            aria-label="容量列表排序"
            className="select compact-select"
            onChange={(event) => setSort(event.target.value as typeof sort)}
            value={sort}
          >
            <option value="usage-desc">使用率从高到低</option>
            <option value="usage-asc">使用率从低到高</option>
            <option value="name">按成员名称</option>
          </select>
        </div>
        <div className="table-wrap">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>系统权限</th>
                <th>资料数</th>
                <th>已用</th>
                <th>上限</th>
                <th>使用率</th>
                <th>调整上限</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => {
                const rawPercent =
                  item.storageQuotaBytes === 0
                    ? 100
                    : Math.round(
                        (item.storageUsedBytes / item.storageQuotaBytes) * 100,
                      );
                const meterPercent = Math.min(100, rawPercent);

                return (
                  <tr key={item.user.id}>
                    <td data-label="成员">
                      <span className="grant-member">
                        <strong>
                          <UserProfileLink
                            className="user-profile-link"
                            user={item.user}
                          />
                        </strong>
                      </span>
                    </td>
                    <td data-label="系统权限">
                      {roleLabel(item.user.systemRole)}
                    </td>
                    <td data-label="资料数">{item.assetCount}</td>
                    <td data-label="已用">
                      {formatStorageSize(item.storageUsedBytes)}
                    </td>
                    <td data-label="上限">
                      {formatStorageSize(item.storageQuotaBytes)}
                    </td>
                    <td data-label="使用率">
                      <div className="storage-usage">
                        <div
                          aria-label={`已使用 ${rawPercent}%`}
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={meterPercent}
                          className="storage-meter"
                          role="progressbar"
                        >
                          <span style={{ width: `${meterPercent}%` }} />
                        </div>
                        <small className="muted">{rawPercent}%</small>
                        {rawPercent >= 90 ? (
                          <strong className="storage-warning">接近上限</strong>
                        ) : null}
                      </div>
                    </td>
                    <td data-label="调整上限">
                      <form
                        className="quota-form"
                        onSubmit={(event) => void onSaveQuota(event, item)}
                      >
                        <input
                          className="table-input"
                          min={0}
                          onChange={(event) =>
                            setQuotaDrafts((current) => ({
                              ...current,
                              [item.user.id]: event.target.value,
                            }))
                          }
                          type="number"
                          value={quotaDrafts[item.user.id] ?? ""}
                        />
                        <span>MB</span>
                        <button
                          className="inline-icon-button"
                          disabled={savingUserId === item.user.id}
                          title="保存容量"
                          type="submit"
                        >
                          <Save aria-hidden="true" />
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={7}>
                    暂无成员。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function bytesToMegabytes(value: number) {
  return Math.round(value / 1024 / 1024);
}

function formatStorageSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
