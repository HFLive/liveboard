"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Database, RotateCcw, Save, School } from "lucide-react";
import {
  getStorageQuotaDefaults,
  listClassrooms,
  listUserStorage,
  updateClassroom,
  updateStorageQuotaDefaults,
  updateUserStorageQuota,
  type StorageQuotaDefaults,
  type UserStorageSummary,
} from "@/lib/api";
import type { ClassroomSummary } from "@liveboard/shared";
import { roleLabel } from "@/lib/labels";
import { UserProfileLink } from "@/components/UserProfileLink";
import { TableSkeletonRows } from "@/components/system/ProgressiveLoading";

export function StorageManagementClient() {
  const [items, setItems] = useState<UserStorageSummary[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [defaults, setDefaults] = useState<StorageQuotaDefaults | null>(null);
  const [userDrafts, setUserDrafts] = useState<Record<string, string>>({});
  const [classroomDrafts, setClassroomDrafts] = useState<
    Record<string, string>
  >({});
  const [memberDefaultDraft, setMemberDefaultDraft] = useState("");
  const [classroomDefaultDraft, setClassroomDefaultDraft] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<"usage-desc" | "usage-asc" | "name">(
    "usage-desc",
  );
  const [loading, setLoading] = useState(true);

  const totalUsedBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.storageUsedBytes, 0),
    [items],
  );
  const totalClassroomUsedBytes = useMemo(
    () => classrooms.reduce((sum, item) => sum + item.storageUsedBytes, 0),
    [classrooms],
  );
  const sortedItems = useMemo(
    () =>
      [...items].sort((left, right) => {
        if (sort === "name") {
          return left.user.displayName.localeCompare(right.user.displayName);
        }
        return usageRatio(right) - usageRatio(left) === 0
          ? 0
          : sort === "usage-asc"
            ? usageRatio(left) - usageRatio(right)
            : usageRatio(right) - usageRatio(left);
      }),
    [items, sort],
  );
  const sortedClassrooms = useMemo(
    () =>
      [...classrooms].sort(
        (left, right) => usageRatio(right) - usageRatio(left),
      ),
    [classrooms],
  );

  function usageRatio(item: {
    storageQuotaBytes: number;
    storageUsedBytes: number;
  }) {
    return item.storageQuotaBytes > 0
      ? item.storageUsedBytes / item.storageQuotaBytes
      : 1;
  }

  async function load() {
    const [userResult, classroomResult, defaultsResult] = await Promise.all([
      listUserStorage(),
      listClassrooms(),
      getStorageQuotaDefaults(),
    ]);
    setItems(userResult.users);
    setClassrooms(classroomResult.classrooms);
    setDefaults(defaultsResult.defaults);
    setUserDrafts(
      Object.fromEntries(
        userResult.users.map((item) => [
          item.user.id,
          bytesToMegabytes(item.storageQuotaBytes).toString(),
        ]),
      ),
    );
    setClassroomDrafts(
      Object.fromEntries(
        classroomResult.classrooms.map((item) => [
          item.id,
          bytesToMegabytes(item.storageQuotaBytes).toString(),
        ]),
      ),
    );
    setMemberDefaultDraft(
      bytesToMegabytes(
        defaultsResult.defaults.memberAttachmentQuotaBytes,
      ).toString(),
    );
    setClassroomDefaultDraft(
      bytesToMegabytes(
        defaultsResult.defaults.classroomStorageQuotaBytes,
      ).toString(),
    );
  }

  useEffect(() => {
    load()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载容量信息失败");
      })
      .finally(() => setLoading(false));
  }, []);

  function parseDraft(draft: string): number | null {
    const quotaMb = Number(draft);
    if (!Number.isFinite(quotaMb) || quotaMb < 0) return null;
    return Math.round(quotaMb * 1024 * 1024);
  }

  async function run(key: string, task: () => Promise<void>) {
    setSavingKey(key);
    setError(null);
    setMessage(null);
    try {
      await task();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存容量上限失败");
    } finally {
      setSavingKey(null);
    }
  }

  async function onSaveDefault(
    event: FormEvent<HTMLFormElement>,
    kind: "member" | "classroom",
  ) {
    event.preventDefault();
    const draft =
      kind === "member" ? memberDefaultDraft : classroomDefaultDraft;
    const bytes = parseDraft(draft);
    if (bytes === null) {
      setError("默认容量必须是不小于 0 的数字");
      return;
    }
    await run(`default-${kind}`, async () => {
      await updateStorageQuotaDefaults(
        kind === "member"
          ? { memberAttachmentQuotaBytes: bytes }
          : { classroomStorageQuotaBytes: bytes },
      );
      setMessage("默认容量已更新，未单独设置的成员和课堂将跟随新默认值");
    });
  }

  async function onResetDefault(kind: "member" | "classroom") {
    await run(`default-${kind}`, async () => {
      await updateStorageQuotaDefaults(
        kind === "member"
          ? { memberAttachmentQuotaBytes: null }
          : { classroomStorageQuotaBytes: null },
      );
      setMessage("已恢复系统默认容量");
    });
  }

  async function onSaveUserQuota(
    event: FormEvent<HTMLFormElement>,
    item: UserStorageSummary,
  ) {
    event.preventDefault();
    const bytes = parseDraft(userDrafts[item.user.id] ?? "");
    if (bytes === null) {
      setError("容量上限必须是不小于 0 的数字");
      return;
    }
    if (bytes < item.storageUsedBytes) {
      setError(
        `容量上限不能低于当前已用的 ${formatStorageSize(item.storageUsedBytes)}`,
      );
      return;
    }
    await run(`user-${item.user.id}`, async () => {
      await updateUserStorageQuota(item.user.id, bytes);
      setMessage("容量上限已更新");
    });
  }

  async function onSaveClassroomQuota(
    event: FormEvent<HTMLFormElement>,
    item: ClassroomSummary,
  ) {
    event.preventDefault();
    const bytes = parseDraft(classroomDrafts[item.id] ?? "");
    if (bytes === null) {
      setError("容量上限必须是不小于 0 的数字");
      return;
    }
    if (bytes < item.storageUsedBytes) {
      setError(
        `容量上限不能低于课堂当前已用的 ${formatStorageSize(item.storageUsedBytes)}`,
      );
      return;
    }
    await run(`classroom-${item.id}`, async () => {
      await updateClassroom(item.id, { storageQuotaBytes: bytes });
      setMessage("课堂容量上限已更新");
    });
  }

  async function onResetUserQuota(item: UserStorageSummary) {
    await run(`user-${item.user.id}`, async () => {
      await updateUserStorageQuota(item.user.id, null);
      setMessage("已恢复为默认容量");
    });
  }

  async function onResetClassroomQuota(item: ClassroomSummary) {
    await run(`classroom-${item.id}`, async () => {
      await updateClassroom(item.id, { storageQuotaBytes: null });
      setMessage("课堂容量已恢复为默认值");
    });
  }

  return (
    <div className="workspace admin-workspace admin-storage-page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">管理中心</p>
          <h1>存储容量</h1>
          <p className="muted">
            统一设置成员文档附件与课堂文件的默认容量，并按需调整个别上限。
          </p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="metric-strip" aria-label="容量概览">
        <article className="metric">
          <span>附件总占用</span>
          {loading ? (
            <span className="skeleton-block admin-metric-value-skeleton" />
          ) : (
            <strong>{formatStorageSize(totalUsedBytes)}</strong>
          )}
        </article>
        <article className="metric">
          <span>课堂文件总占用</span>
          {loading ? (
            <span className="skeleton-block admin-metric-value-skeleton" />
          ) : (
            <strong>{formatStorageSize(totalClassroomUsedBytes)}</strong>
          )}
        </article>
        <article className="metric">
          <span>成员数</span>
          {loading ? (
            <span className="skeleton-block admin-metric-value-skeleton" />
          ) : (
            <strong>{items.length}</strong>
          )}
        </article>
        <article className="metric">
          <span>课堂数</span>
          {loading ? (
            <span className="skeleton-block admin-metric-value-skeleton" />
          ) : (
            <strong>{classrooms.length}</strong>
          )}
        </article>
      </section>

      <section className="workbench-main">
        <div className="panel-head">
          <div>
            <h2>
              <Database aria-hidden="true" className="heading-icon" />
              默认容量
            </h2>
            <p>
              未单独设置上限的成员和课堂使用默认容量；恢复默认后回到系统内置的
              128 MB 与 512 MB。
            </p>
          </div>
        </div>
        <div className="quota-defaults">
          <form
            className="quota-default-row"
            onSubmit={(event) => void onSaveDefault(event, "member")}
          >
            <span className="quota-default-label">
              成员文档附件默认容量
              {defaults && !defaults.memberAttachmentQuotaCustom ? (
                <small className="muted">（系统默认）</small>
              ) : null}
            </span>
            <input
              aria-label="成员文档附件默认容量（MB）"
              className="table-input"
              min={0}
              onChange={(event) => setMemberDefaultDraft(event.target.value)}
              type="number"
              value={memberDefaultDraft}
            />
            <span>MB</span>
            <button
              className="inline-icon-button"
              disabled={savingKey === "default-member"}
              title="保存默认容量"
              type="submit"
            >
              <Save aria-hidden="true" />
            </button>
            {defaults?.memberAttachmentQuotaCustom ? (
              <button
                className="inline-icon-button"
                disabled={savingKey === "default-member"}
                onClick={() => void onResetDefault("member")}
                title="恢复系统默认 128 MB"
                type="button"
              >
                <RotateCcw aria-hidden="true" />
              </button>
            ) : null}
          </form>
          <form
            className="quota-default-row"
            onSubmit={(event) => void onSaveDefault(event, "classroom")}
          >
            <span className="quota-default-label">
              课堂文件默认容量
              {defaults && !defaults.classroomStorageQuotaCustom ? (
                <small className="muted">（系统默认）</small>
              ) : null}
            </span>
            <input
              aria-label="课堂文件默认容量（MB）"
              className="table-input"
              min={0}
              onChange={(event) => setClassroomDefaultDraft(event.target.value)}
              type="number"
              value={classroomDefaultDraft}
            />
            <span>MB</span>
            <button
              className="inline-icon-button"
              disabled={savingKey === "default-classroom"}
              title="保存默认容量"
              type="submit"
            >
              <Save aria-hidden="true" />
            </button>
            {defaults?.classroomStorageQuotaCustom ? (
              <button
                className="inline-icon-button"
                disabled={savingKey === "default-classroom"}
                onClick={() => void onResetDefault("classroom")}
                title="恢复系统默认 512 MB"
                type="button"
              >
                <RotateCcw aria-hidden="true" />
              </button>
            ) : null}
          </form>
        </div>
      </section>

      <section className="workbench-main">
        <div className="panel-head">
          <div>
            <h2>
              <Database aria-hidden="true" className="heading-icon" />
              成员文档附件容量
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
                <th>附件数</th>
                <th>已用</th>
                <th>上限</th>
                <th>使用率</th>
                <th>调整上限</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <TableSkeletonRows colSpan={7} count={6} /> : null}
              {sortedItems.map((item) => (
                <tr key={item.user.id}>
                  <td data-label="成员">
                    <span className="grant-member">
                      <strong>
                        <UserProfileLink
                          className="user-profile-link"
                          compactBadges
                          user={item.user}
                        />
                      </strong>
                    </span>
                  </td>
                  <td data-label="系统权限">
                    {roleLabel(item.user.systemRole)}
                  </td>
                  <td data-label="附件数">{item.assetCount}</td>
                  <td data-label="已用">
                    {formatStorageSize(item.storageUsedBytes)}
                  </td>
                  <td data-label="上限">
                    {formatStorageSize(item.storageQuotaBytes)}
                    {!item.storageQuotaCustom ? (
                      <small className="muted">（默认）</small>
                    ) : null}
                  </td>
                  <td data-label="使用率">
                    <UsageMeter
                      quotaBytes={item.storageQuotaBytes}
                      usedBytes={item.storageUsedBytes}
                    />
                  </td>
                  <td data-label="调整上限">
                    <form
                      className="quota-form"
                      onSubmit={(event) => void onSaveUserQuota(event, item)}
                    >
                      <input
                        aria-label={`${item.user.displayName}的容量上限（MB）`}
                        className="table-input"
                        min={0}
                        onChange={(event) =>
                          setUserDrafts((current) => ({
                            ...current,
                            [item.user.id]: event.target.value,
                          }))
                        }
                        type="number"
                        value={userDrafts[item.user.id] ?? ""}
                      />
                      <span>MB</span>
                      <button
                        className="inline-icon-button"
                        disabled={savingKey === `user-${item.user.id}`}
                        title="保存容量"
                        type="submit"
                      >
                        <Save aria-hidden="true" />
                      </button>
                      {item.storageQuotaCustom ? (
                        <button
                          className="inline-icon-button"
                          disabled={savingKey === `user-${item.user.id}`}
                          onClick={() => void onResetUserQuota(item)}
                          title="恢复默认容量"
                          type="button"
                        >
                          <RotateCcw aria-hidden="true" />
                        </button>
                      ) : null}
                    </form>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 ? (
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

      <section className="workbench-main">
        <div className="panel-head">
          <div>
            <h2>
              <School aria-hidden="true" className="heading-icon" />
              课堂文件容量
            </h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th>课堂</th>
                <th>文件数</th>
                <th>已用</th>
                <th>上限</th>
                <th>使用率</th>
                <th>调整上限</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <TableSkeletonRows colSpan={6} count={4} /> : null}
              {sortedClassrooms.map((item) => (
                <tr key={item.id}>
                  <td data-label="课堂">
                    <strong>{item.name}</strong>
                  </td>
                  <td data-label="文件数">{item.fileCount}</td>
                  <td data-label="已用">
                    {formatStorageSize(item.storageUsedBytes)}
                  </td>
                  <td data-label="上限">
                    {formatStorageSize(item.storageQuotaBytes)}
                    {!item.storageQuotaCustom ? (
                      <small className="muted">（默认）</small>
                    ) : null}
                  </td>
                  <td data-label="使用率">
                    <UsageMeter
                      quotaBytes={item.storageQuotaBytes}
                      usedBytes={item.storageUsedBytes}
                    />
                  </td>
                  <td data-label="调整上限">
                    <form
                      className="quota-form"
                      onSubmit={(event) =>
                        void onSaveClassroomQuota(event, item)
                      }
                    >
                      <input
                        aria-label={`${item.name}的容量上限（MB）`}
                        className="table-input"
                        min={0}
                        onChange={(event) =>
                          setClassroomDrafts((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        type="number"
                        value={classroomDrafts[item.id] ?? ""}
                      />
                      <span>MB</span>
                      <button
                        className="inline-icon-button"
                        disabled={savingKey === `classroom-${item.id}`}
                        title="保存容量"
                        type="submit"
                      >
                        <Save aria-hidden="true" />
                      </button>
                      {item.storageQuotaCustom ? (
                        <button
                          className="inline-icon-button"
                          disabled={savingKey === `classroom-${item.id}`}
                          onClick={() => void onResetClassroomQuota(item)}
                          title="恢复默认容量"
                          type="button"
                        >
                          <RotateCcw aria-hidden="true" />
                        </button>
                      ) : null}
                    </form>
                  </td>
                </tr>
              ))}
              {!loading && classrooms.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={6}>
                    暂无课堂。
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

function UsageMeter({
  usedBytes,
  quotaBytes,
}: {
  usedBytes: number;
  quotaBytes: number;
}) {
  const rawPercent =
    quotaBytes === 0 ? 100 : Math.round((usedBytes / quotaBytes) * 100);
  const meterPercent = Math.min(100, rawPercent);
  return (
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
