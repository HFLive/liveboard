"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type {
  AdminBadgeSummary,
  AdminUserSummary,
  BadgeColor,
} from "@liveboard/shared";
import {
  awardBadge,
  createBadge,
  deleteBadge,
  listAdminBadges,
  listUsers,
  revokeBadge,
  updateBadge,
} from "@/lib/api";
import { UserBadges } from "@/components/UserBadges";
import { UserProfileLink } from "@/components/UserProfileLink";

const colorOptions: Array<{ value: BadgeColor; label: string }> = [
  { value: "gold", label: "金色" },
  { value: "blue", label: "蓝色" },
  { value: "green", label: "绿色" },
  { value: "purple", label: "紫色" },
  { value: "red", label: "红色" },
  { value: "gray", label: "灰色" },
];

type BadgeDraft = {
  name: string;
  description: string;
  color: BadgeColor;
};

const emptyDraft: BadgeDraft = {
  name: "",
  description: "",
  color: "gold",
};

export function BadgeManagementClient() {
  const [badges, setBadges] = useState<AdminBadgeSummary[]>([]);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);
  const [editingBadge, setEditingBadge] = useState<AdminBadgeSummary | null>(
    null,
  );
  const [badgeEditorOpen, setBadgeEditorOpen] = useState(false);
  const [draft, setDraft] = useState<BadgeDraft>(emptyDraft);
  const [search, setSearch] = useState("");
  const [tagId, setTagId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedBadge =
    badges.find((badge) => badge.id === selectedBadgeId) ?? badges[0] ?? null;

  const tags = useMemo(() => {
    const byId = new Map<string, string>();
    users.forEach((user) =>
      user.tags?.forEach((tag) => byId.set(tag.id, tag.name)),
    );
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return users.filter((user) => {
      const matchesSearch =
        !query ||
        user.displayName.toLocaleLowerCase("zh-CN").includes(query) ||
        user.username.toLocaleLowerCase("zh-CN").includes(query);
      const matchesTag = !tagId || user.tags?.some((tag) => tag.id === tagId);
      return matchesSearch && matchesTag;
    });
  }, [search, tagId, users]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [badgeResult, userResult] = await Promise.all([
        listAdminBadges(),
        listUsers(),
      ]);
      setBadges(badgeResult.badges);
      setUsers(userResult.users);
      setSelectedBadgeId((current) =>
        badgeResult.badges.some((badge) => badge.id === current)
          ? current
          : (badgeResult.badges[0]?.id ?? null),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载徽章失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditingBadge(null);
    setDraft(emptyDraft);
    setBadgeEditorOpen(true);
  }

  function openEdit(badge: AdminBadgeSummary) {
    setEditingBadge(badge);
    setDraft({
      name: badge.name,
      description: badge.description ?? "",
      color: badge.color,
    });
    setBadgeEditorOpen(true);
  }

  async function saveBadge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError("徽章名称不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingBadge) {
        await updateBadge(editingBadge.id, {
          name: draft.name.trim(),
          description: draft.description,
          color: draft.color,
        });
        setMessage("徽章已更新");
      } else {
        await createBadge({
          name: draft.name.trim(),
          description: draft.description,
          color: draft.color,
        });
        setMessage("徽章已创建");
      }
      setBadgeEditorOpen(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存徽章失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeBadge(badge: AdminBadgeSummary) {
    if (
      !window.confirm(
        `确定删除“${badge.name}”吗？该徽章会从 ${badge.recipientCount} 位成员的账户中移除。`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await deleteBadge(badge.id);
      setMessage("徽章已删除");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除徽章失败");
    }
  }

  async function toggleRecipient(userId: string, awarded: boolean) {
    if (!selectedBadge) return;
    setBusyUserId(userId);
    setError(null);
    try {
      if (awarded) {
        await revokeBadge(selectedBadge.id, userId);
        setMessage("已收回徽章");
      } else {
        await awardBadge(selectedBadge.id, userId);
        setMessage("徽章已派发");
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新派发状态失败");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="workspace admin-badges-page">
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <header className="compact-page-head">
        <div>
          <h1>徽章认证</h1>
          <p>设置公开徽章并派发给成员；成员最多同时佩戴 3 个。</p>
        </div>
        <button className="button" onClick={openCreate} type="button">
          <Plus aria-hidden="true" className="button-icon" />
          新建徽章
        </button>
      </header>

      <section className="badge-admin-layout">
        <div className="badge-catalog">
          <div className="panel-head">
            <h2>徽章</h2>
            <span className="muted">{badges.length} 个</span>
          </div>
          {loading ? <div className="skeleton badge-list-skeleton" /> : null}
          {!loading && badges.length === 0 ? (
            <div className="empty-panel">
              <BadgeCheck aria-hidden="true" />
              <strong>还没有徽章</strong>
              <span>创建第一个徽章后即可向成员派发。</span>
            </div>
          ) : null}
          <div className="badge-catalog-list">
            {badges.map((badge) => (
              <button
                className={selectedBadge?.id === badge.id ? "active" : ""}
                key={badge.id}
                onClick={() => setSelectedBadgeId(badge.id)}
                type="button"
              >
                <UserBadges badges={[badge]} />
                <span>{badge.recipientCount} 人获得</span>
              </button>
            ))}
          </div>
        </div>

        <div className="badge-detail">
          {selectedBadge ? (
            <>
              <div className="panel-head badge-detail-head">
                <div>
                  <UserBadges badges={[selectedBadge]} />
                  <p>{selectedBadge.description || "暂无说明"}</p>
                </div>
                <div className="inline-actions">
                  <button
                    className="inline-icon-button"
                    onClick={() => openEdit(selectedBadge)}
                    title="编辑徽章"
                    type="button"
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    className="inline-icon-button danger"
                    onClick={() => void removeBadge(selectedBadge)}
                    title="删除徽章"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="badge-member-toolbar">
                <label className="search-field">
                  <Search aria-hidden="true" />
                  <input
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索姓名或账号"
                    value={search}
                  />
                </label>
                <select
                  aria-label="按成员标签筛选"
                  className="select"
                  onChange={(event) => setTagId(event.target.value)}
                  value={tagId}
                >
                  <option value="">全部标签</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="badge-member-list">
                {filteredUsers.map((user) => {
                  const awarded = selectedBadge.recipientIds.includes(user.id);
                  return (
                    <label key={user.id}>
                      <input
                        checked={awarded}
                        disabled={busyUserId === user.id}
                        onChange={() => void toggleRecipient(user.id, awarded)}
                        type="checkbox"
                      />
                      <span className="badge-member-identity">
                        <UserProfileLink user={user} />
                        <small>@{user.username}</small>
                      </span>
                      <span className="user-tag-list">
                        {user.tags?.map((tag) => (
                          <span className="user-tag" key={tag.id}>
                            {tag.name}
                          </span>
                        ))}
                      </span>
                      <span className="muted">
                        {awarded ? "已派发" : "未派发"}
                      </span>
                    </label>
                  );
                })}
                {filteredUsers.length === 0 ? (
                  <p className="empty-cell">没有符合筛选条件的成员。</p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="empty-panel">
              <span>选择或新建徽章后管理派发成员。</span>
            </div>
          )}
        </div>
      </section>

      {badgeEditorOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-panel badge-editor-modal" onSubmit={saveBadge}>
            <div className="modal-head">
              <h2>{editingBadge ? "编辑徽章" : "新建徽章"}</h2>
              <button
                className="icon-button subtle"
                onClick={() => setBadgeEditorOpen(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <label className="label">
                名称
                <input
                  autoFocus
                  className="input"
                  maxLength={20}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如：认证教师"
                  value={draft.name}
                />
              </label>
              <label className="label">
                说明
                <textarea
                  className="textarea"
                  maxLength={120}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="说明获得该徽章所代表的身份或荣誉"
                  rows={3}
                  value={draft.description}
                />
              </label>
              <fieldset className="badge-color-field">
                <legend>颜色</legend>
                <div>
                  {colorOptions.map((option) => (
                    <label key={option.value}>
                      <input
                        checked={draft.color === option.value}
                        name="badge-color"
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            color: option.value,
                          }))
                        }
                        type="radio"
                      />
                      <UserBadges
                        badges={[
                          {
                            id: option.value,
                            name: option.label,
                            description: null,
                            color: option.value,
                          },
                        ]}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="modal-foot">
              <button
                className="button secondary"
                onClick={() => setBadgeEditorOpen(false)}
                type="button"
              >
                取消
              </button>
              <button className="button" disabled={saving} type="submit">
                {saving ? "保存中" : editingBadge ? "保存修改" : "创建徽章"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
