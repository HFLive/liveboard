"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Check, Send } from "lucide-react";
import type { ForumCategorySummary } from "@liveboard/shared";
import { createForumThread, listForumOverview } from "@/lib/api";
import { APP_ROUTES, forumThread } from "@/lib/routes";

export function NewForumThreadClient() {
  const router = useRouter();
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    listForumOverview()
      .then((result) => {
        if (!mounted) {
          return;
        }

        setCategories(result.categories);
        setCategoryId(result.categories[0]?.id ?? "");
      })
      .catch((caught) => {
        if (mounted) {
          setError(caught instanceof Error ? caught.message : "加载版块失败");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!categoryId) {
      setError("请先选择版块");
      return;
    }

    setSubmitting(true);

    try {
      const result = await createForumThread({
        categoryId,
        title,
        body,
      });

      router.push(forumThread(result.thread.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建主题失败");
      setSubmitting(false);
    }
  }

  const canSubmit =
    !loading &&
    !submitting &&
    Boolean(categoryId) &&
    Boolean(title.trim()) &&
    Boolean(body.trim());
  const selectedCategory = categories.find(
    (category) => category.id === categoryId,
  );

  return (
    <div className="workspace forum-compose-workspace">
      <Link className="page-back-link" href={APP_ROUTES.forum}>
        <ArrowLeft aria-hidden="true" />
        返回论坛
      </Link>
      <section className="page-head">
        <div>
          <p className="page-eyebrow">论坛</p>
          <h1>发布主题</h1>
          <p className="muted">写清楚主题和背景，让其他成员更容易参与。</p>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="forum-compose-layout" aria-label="发布论坛主题">
        <form
          className="forum-new-shell forum-new-form surface"
          onSubmit={handleSubmit}
        >
          <fieldset className="forum-category-picker">
            <legend>选择版块</legend>
            <div>
              {categories.map((category) => (
                <button
                  className={category.id === categoryId ? "active" : ""}
                  key={category.id}
                  onClick={() => setCategoryId(category.id)}
                  type="button"
                >
                  <span>
                    <strong>{category.name}</strong>
                    <small>{category.description ?? "暂无说明"}</small>
                  </span>
                  {category.id === categoryId ? (
                    <Check aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
            {!loading && categories.length === 0 ? (
              <p className="notice-box">暂无可用版块，请联系管理员创建。</p>
            ) : null}
          </fieldset>

          <label className="label">
            <span className="forum-field-label">
              标题
              <small>{title.length}/120</small>
            </span>
            <input
              autoFocus
              className="input"
              maxLength={120}
              placeholder="一句话说清楚问题或主题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="label">
            <span className="forum-field-label">
              正文
              <small>{body.length}/8000</small>
            </span>
            <textarea
              className="textarea"
              maxLength={8000}
              placeholder="说明背景、你的想法或已经尝试过的方法……"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>

          <div className="forum-new-actions">
            <Link className="button secondary" href={APP_ROUTES.forum}>
              取消
            </Link>
            <button className="button" disabled={!canSubmit} type="submit">
              <Send aria-hidden="true" className="button-icon" />
              {submitting ? "发布中" : "发布到论坛"}
            </button>
          </div>
        </form>
        <aside className="forum-compose-guide surface">
          <span>发布到</span>
          <strong>{selectedCategory?.name ?? "尚未选择版块"}</strong>
          <p>{selectedCategory?.description ?? "请选择与主题最相关的版块。"}</p>
          <div>
            <h2>更容易获得回复</h2>
            <ul>
              <li>标题直接说明问题或观点</li>
              <li>正文补充必要背景</li>
              <li>说明你已经尝试过什么</li>
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}
