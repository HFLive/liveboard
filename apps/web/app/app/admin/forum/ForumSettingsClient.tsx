"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { MessageSquare, Plus, Save, Trash2, X } from "lucide-react";
import type { ForumCategorySummary } from "@liveboard/shared";
import {
  createForumCategory,
  deleteForumCategory,
  listForumCategories,
  updateForumCategory,
} from "@/lib/api";
import { AdminSubnav } from "@/components/admin/AdminSubnav";

type CategoryDraft = {
  name: string;
  description: string;
  sortOrder: number;
};

const emptyDraft: CategoryDraft = {
  name: "",
  description: "",
  sortOrder: 100,
};

export function ForumSettingsClient() {
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<CategoryDraft>(emptyDraft);
  const [editDraft, setEditDraft] = useState<CategoryDraft>(emptyDraft);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedId) ?? null,
    [categories, selectedId],
  );

  async function loadCategories() {
    const result = await listForumCategories();
    setCategories(result.categories);
    setSelectedId((current) =>
      result.categories.some((category) => category.id === current)
        ? current
        : (result.categories[0]?.id ?? null),
    );
  }

  useEffect(() => {
    loadCategories().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载论坛版块失败");
    });
  }, []);

  useEffect(() => {
    if (!selectedCategory) {
      setEditDraft(emptyDraft);
      return;
    }

    setEditDraft({
      name: selectedCategory.name,
      description: selectedCategory.description ?? "",
      sortOrder: selectedCategory.sortOrder,
    });
  }, [selectedCategory]);

  async function onCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      const result = await createForumCategory(createDraft);
      setCreateDraft(emptyDraft);
      setShowCreateModal(false);
      setMessage("版块已创建");
      await loadCategories();
      setSelectedId(result.category.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建版块失败");
    }
  }

  async function onSaveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedCategory) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const result = await updateForumCategory(selectedCategory.id, editDraft);
      setCategories((current) =>
        current.map((category) =>
          category.id === selectedCategory.id ? result.category : category,
        ),
      );
      setMessage("版块已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存版块失败");
    }
  }

  async function onDeleteCategory() {
    if (
      !selectedCategory ||
      !window.confirm(
        `确定删除「${selectedCategory.name}」吗？已有主题的版块不能删除。`,
      )
    ) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      await deleteForumCategory(selectedCategory.id);
      setMessage("版块已删除");
      setSelectedId(null);
      await loadCategories();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除版块失败");
    }
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">管理中心</p>
          <h1>论坛设置</h1>
          <p className="muted">维护论坛版块、展示顺序和内容入口。</p>
        </div>
        <div className="page-toolbar">
          <button
            className="button"
            onClick={() => setShowCreateModal(true)}
            type="button"
          >
            <Plus aria-hidden="true" className="button-icon" />
            新建版块
          </button>
        </div>
      </header>

      <AdminSubnav />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="workbench forum-admin-layout">
        <aside className="action-panel">
          <div className="panel-title-row">
            <h2>
              <MessageSquare aria-hidden="true" className="heading-icon" />
              版块
            </h2>
            <span className="muted">{categories.length} 个</span>
          </div>

          <div className="forum-admin-category-list">
            {categories.map((category) => (
              <button
                className={
                  selectedId === category.id
                    ? "forum-admin-category-row active"
                    : "forum-admin-category-row"
                }
                key={category.id}
                onClick={() => setSelectedId(category.id)}
                type="button"
              >
                <span>
                  <strong>{category.name}</strong>
                  <small>{category.description ?? "暂无描述"}</small>
                </span>
                <em>{category.threadCount}</em>
              </button>
            ))}
          </div>
        </aside>

        <section className="workbench-main">
          <div className="panel-head">
            <div>
              <h2>版块信息</h2>
            </div>
          </div>

          {selectedCategory ? (
            <form className="profile-form" onSubmit={onSaveCategory}>
              <label className="label">
                名称
                <input
                  className="input"
                  maxLength={40}
                  value={editDraft.name}
                  onChange={(event) =>
                    setEditDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="label">
                描述
                <textarea
                  className="textarea"
                  maxLength={140}
                  value={editDraft.description}
                  onChange={(event) =>
                    setEditDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="label">
                排序
                <input
                  className="input"
                  min={0}
                  type="number"
                  value={editDraft.sortOrder}
                  onChange={(event) =>
                    setEditDraft((current) => ({
                      ...current,
                      sortOrder: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <div className="button-row left">
                <button
                  className="button"
                  disabled={!editDraft.name.trim()}
                  type="submit"
                >
                  <Save aria-hidden="true" className="button-icon" />
                  保存
                </button>
                <button
                  className="button danger"
                  disabled={selectedCategory.threadCount > 0}
                  onClick={onDeleteCategory}
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="button-icon" />
                  删除空版块
                </button>
              </div>
            </form>
          ) : (
            <div className="empty-panel">
              <strong>暂无版块</strong>
              <span>先创建一个论坛版块。</span>
            </div>
          )}
        </section>
      </section>

      {showCreateModal ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-panel" onSubmit={onCreateCategory}>
            <div className="modal-head">
              <h2>新建版块</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowCreateModal(false)}
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
                  maxLength={40}
                  placeholder="版块名称"
                  value={createDraft.name}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="label">
                描述
                <textarea
                  className="textarea"
                  maxLength={140}
                  placeholder="版块说明"
                  value={createDraft.description}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="label">
                排序
                <input
                  className="input"
                  min={0}
                  type="number"
                  value={createDraft.sortOrder}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      sortOrder: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setShowCreateModal(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={!createDraft.name.trim()}
                  type="submit"
                >
                  创建
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
