"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Send } from "lucide-react";
import type { ForumCategorySummary } from "@liveboard/shared";
import {
  createForumThread,
  listForumOverview,
  uploadForumPostImageDirect,
} from "@/lib/api";
import { APP_ROUTES, forumThread } from "@/lib/routes";
import { ForumImagePicker } from "../ForumImagePicker";
import { AutoTextarea } from "@/components/AutoTextarea";
import {
  prepareUploadJobs,
  useUploadTask,
} from "@/components/upload/useUploadTask";
import { UploadTaskToast } from "@/components/upload/UploadTaskToast";

export function NewForumThreadClient() {
  const router = useRouter();
  const { tasks, uploadFiles, cancelUpload, dismissUpload } = useUploadTask();
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [processingImages, setProcessingImages] = useState(false);
  const [createdTarget, setCreatedTarget] = useState<{
    threadId: string;
    postId: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 菜单里的「匿名发布」点击时置位，随后触发的 submit 读取并复位。
  const pendingAnonymousRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

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

  useEffect(() => {
    if (!publishMenuOpen) {
      return;
    }
    function closeOnOutside(event: MouseEvent) {
      if (
        event.target instanceof Element &&
        !event.target.closest(".forum-publish-dropdown")
      ) {
        setPublishMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [publishMenuOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!categoryId) {
      setError("请先选择版块");
      return;
    }

    const isAnonymous = pendingAnonymousRef.current;
    pendingAnonymousRef.current = false;

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
        const jobs = prepareUploadJobs(images, [], "重复图片");
        const outcomes = await uploadFiles(jobs, (job, uploadOptions) =>
          uploadForumPostImageDirect(target.postId, job.file, uploadOptions),
        );
        const failed = outcomes.filter((outcome) => outcome.error);
        if (failed.length > 0) {
          throw new Error(
            failed[0]?.error instanceof Error
              ? failed[0].error.message
              : "图片上传失败",
          );
        }
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
          ref={formRef}
          className="forum-new-shell forum-new-form surface"
          onSubmit={handleSubmit}
        >
          <div className="forum-compose-row">
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
          </div>

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
            <Link className="button secondary" href={APP_ROUTES.forum}>
              取消
            </Link>
            {createdTarget ? (
              <button
                className="button forum-submit-button"
                disabled={!canSubmit}
                type="submit"
              >
                <Send aria-hidden="true" className="button-icon" />
                {submitting ? "发布中" : "重试上传图片"}
              </button>
            ) : (
              <div className="forum-publish-dropdown">
                <button
                  className="button forum-submit-button"
                  disabled={!canSubmit}
                  type="submit"
                >
                  <Send aria-hidden="true" className="button-icon" />
                  {submitting ? "发布中" : "发布"}
                </button>
                <button
                  aria-expanded={publishMenuOpen}
                  aria-label="更多发布方式"
                  className="forum-publish-caret"
                  disabled={!canSubmit}
                  onClick={() => setPublishMenuOpen((open) => !open)}
                  title="更多发布方式"
                  type="button"
                >
                  <ChevronDown aria-hidden="true" />
                </button>
                {publishMenuOpen ? (
                  <div className="context-menu forum-publish-menu-list">
                    <button
                      disabled={!canSubmit}
                      onClick={() => {
                        pendingAnonymousRef.current = true;
                        setPublishMenuOpen(false);
                        // 菜单项在点击时会被卸载，卸载中的 submit 按钮不会触发提交，
                        // 所以这里手动 requestSubmit。
                        formRef.current?.requestSubmit();
                      }}
                      type="button"
                    >
                      匿名发布
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </form>
      </section>
      <UploadTaskToast
        tasks={tasks}
        onCancel={cancelUpload}
        onDismiss={dismissUpload}
      />
    </div>
  );
}
