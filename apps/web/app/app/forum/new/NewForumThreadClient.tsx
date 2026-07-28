"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Send } from "lucide-react";
import type { ForumCategorySummary } from "@liveboard/shared";
import {
  createForumThread,
  listForumOverview,
  uploadForumPostImages,
} from "@/lib/api";
import { APP_ROUTES, forumThread } from "@/lib/routes";
import { ForumImagePicker } from "../ForumImagePicker";
import { AutoTextarea } from "@/components/AutoTextarea";

export function NewForumThreadClient() {
  const router = useRouter();
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [processingImages, setProcessingImages] = useState(false);
  const [createdTarget, setCreatedTarget] = useState<{
    threadId: string;
    postId: string;
  } | null>(null);
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
      let target = createdTarget;
      if (!target) {
        const result = await createForumThread({
          categoryId,
          title,
          body,
          isAnonymous,
        });
        const postId = result.thread.posts[0]?.id;
        if (!postId) throw new Error("帖子创建成功，但未找到正文");
        target = { threadId: result.thread.id, postId };
        setCreatedTarget(target);
      }

      if (images.length > 0) {
        await uploadForumPostImages(target.postId, images);
      }

      router.push(forumThread(target.threadId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发帖失败");
      setSubmitting(false);
    }
  }

  const canSubmit =
    !loading &&
    !submitting &&
    !processingImages &&
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
          <h1>发帖</h1>
          <p className="muted">写清楚内容和背景，让其他成员更容易参与。</p>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="forum-compose-layout" aria-label="论坛发帖">
        <form
          className="forum-new-shell forum-new-form surface"
          onSubmit={handleSubmit}
        >
          <fieldset className="forum-category-picker">
            <legend>选择版块</legend>
            <select
              className="select"
              disabled={loading || categories.length === 0}
              onChange={(event) => setCategoryId(event.target.value)}
              value={categoryId}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {selectedCategory ? (
              <p>{selectedCategory.description ?? "暂无说明"}</p>
            ) : null}
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
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="label">
            <span className="forum-field-label">
              正文
              <small>{body.length}/8000</small>
            </span>
            <AutoTextarea
              className="textarea"
              maxLength={8000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>

          <ForumImagePicker
            disabled={submitting || Boolean(createdTarget)}
            onChange={setImages}
            onError={setError}
            onProcessingChange={setProcessingImages}
            value={images}
          />

          <div className="forum-new-actions">
            <label className="forum-anonymous-option">
              <input
                checked={isAnonymous}
                onChange={(event) => setIsAnonymous(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>匿名</strong>
              </span>
            </label>
            <Link className="button secondary" href={APP_ROUTES.forum}>
              取消
            </Link>
            <button
              className="button forum-submit-button"
              disabled={!canSubmit}
              type="submit"
            >
              <Send aria-hidden="true" className="button-icon" />
              {submitting ? "发布中" : createdTarget ? "重试上传图片" : "发布"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
