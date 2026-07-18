"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Lock,
  MessageSquareReply,
  Pencil,
  Save,
  Send,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import type {
  ForumCategorySummary,
  ForumPostSummary,
  ForumThreadDetail,
} from "@liveboard/shared";
import {
  createForumPost,
  deleteForumPost,
  deleteForumThread,
  getForumThread,
  listForumOverview,
  uploadForumPostImages,
  updateForumPost,
  updateForumThread,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/labels";
import { APP_ROUTES } from "@/lib/routes";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { UserProfileLink } from "@/components/UserProfileLink";
import { ForumUserAvatar } from "../ForumUserAvatar";
import { ForumImagePicker } from "../ForumImagePicker";
import { ForumPostImages } from "../ForumPostImages";
import { AutoTextarea } from "@/components/AutoTextarea";

interface ForumThreadClientProps {
  threadId: string;
}

export function ForumThreadClient({ threadId }: ForumThreadClientProps) {
  const router = useRouter();
  const [thread, setThread] = useState<ForumThreadDetail | null>(null);
  useDocumentTitle(thread?.title ?? null);
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [reply, setReply] = useState("");
  const [activeReplyPostId, setActiveReplyPostId] = useState<string | null>(
    null,
  );
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [anonymousReplies, setAnonymousReplies] = useState<
    Record<string, boolean>
  >({});
  const [replyImages, setReplyImages] = useState<Record<string, File[]>>({});
  const [processingReplyImages, setProcessingReplyImages] = useState<
    Record<string, boolean>
  >({});
  const [pendingReplyPosts, setPendingReplyPosts] = useState<
    Record<string, ForumPostSummary>
  >({});
  const [editingThread, setEditingThread] = useState(false);
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [threadCategoryDraft, setThreadCategoryDraft] = useState("");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [postDraft, setPostDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    Promise.all([getForumThread(threadId), listForumOverview()])
      .then(([threadResult, overview]) => {
        if (mounted) {
          setThread(threadResult.thread);
          setCategories(overview.categories);
        }
      })
      .catch((caught) => {
        if (mounted) {
          setError(caught instanceof Error ? caught.message : "加载帖子失败");
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
  }, [threadId]);

  async function handleReply(
    event: FormEvent<HTMLFormElement>,
    parentId?: string,
  ) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const body = parentId ? (replyDrafts[parentId] ?? "") : reply;
    const anonymousKey = parentId ?? "root";

    try {
      let post = pendingReplyPosts[anonymousKey];
      if (!post) {
        const result = await createForumPost(threadId, {
          body,
          parentId,
          isAnonymous: anonymousReplies[anonymousKey] ?? false,
        });
        post = result.post;
        setPendingReplyPosts((current) => ({
          ...current,
          [anonymousKey]: result.post,
        }));
      }

      const images = replyImages[anonymousKey] ?? [];
      if (images.length > 0 && post.images.length === 0) {
        const uploaded = await uploadForumPostImages(post.id, images);
        post = { ...post, images: uploaded.images };
      }

      if (parentId) {
        setReplyDrafts((current) => {
          const next = { ...current };
          delete next[parentId];
          return next;
        });
        setActiveReplyPostId(null);
      } else {
        setReply("");
      }
      setAnonymousReplies((current) => ({
        ...current,
        [anonymousKey]: false,
      }));
      setReplyImages((current) => ({ ...current, [anonymousKey]: [] }));
      setPendingReplyPosts((current) => {
        const next = { ...current };
        delete next[anonymousKey];
        return next;
      });

      setThread((current) =>
        current
          ? {
              ...current,
              posts: [...current.posts, post],
              postCount: current.postCount + 1,
              lastActivityAt: post.createdAt,
              updatedAt: post.createdAt,
            }
          : current,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "回复失败");
    } finally {
      setSubmitting(false);
    }
  }

  function renderAnonymousOption(key: string) {
    return (
      <label className="forum-anonymous-option compact">
        <input
          checked={anonymousReplies[key] ?? false}
          onChange={(event) =>
            setAnonymousReplies((current) => ({
              ...current,
              [key]: event.target.checked,
            }))
          }
          type="checkbox"
        />
        <span>
          <strong>匿名</strong>
        </span>
      </label>
    );
  }

  function renderImagePicker(key: string) {
    return (
      <ForumImagePicker
        disabled={submitting || Boolean(pendingReplyPosts[key])}
        onChange={(images) =>
          setReplyImages((current) => ({ ...current, [key]: images }))
        }
        onError={setError}
        onProcessingChange={(processing) =>
          setProcessingReplyImages((current) => ({
            ...current,
            [key]: processing,
          }))
        }
        maxImages={3}
        value={replyImages[key] ?? []}
      />
    );
  }

  function renderCommentMeta(post: ForumPostSummary) {
    return (
      <span className="forum-comment-meta">
        <span className="forum-comment-author-line">
          <strong>
            {post.isAnonymous ? (
              "匿名用户"
            ) : (
              <UserProfileLink
                className="user-profile-link"
                user={post.author}
              />
            )}
          </strong>
          {post.isAnonymous && post.author.id !== "anonymous" ? (
            <small className="forum-comment-real-identity">
              真实身份：
              <UserProfileLink
                className="user-profile-link"
                user={post.author}
              />
            </small>
          ) : null}
        </span>
        <small className="forum-comment-time">
          {formatRelativeTime(post.createdAt)}
          {post.updatedAt !== post.createdAt ? " · 已编辑" : ""}
        </small>
      </span>
    );
  }

  function startEditThread() {
    if (!thread) {
      return;
    }

    setEditingThread(true);
    setThreadTitleDraft(thread.title);
    setThreadCategoryDraft(thread.categoryId);
    setError(null);
  }

  async function saveThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!thread) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const result = await updateForumThread(thread.id, {
        title: threadTitleDraft,
        categoryId: threadCategoryDraft,
      });
      setThread(result.thread);
      setEditingThread(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存帖子失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function setThreadStatus(status: "open" | "locked") {
    if (!thread) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const result = await updateForumThread(thread.id, { status });
      setThread(result.thread);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新帖子状态失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function deleteThread() {
    if (
      !thread ||
      !window.confirm("帖子及其全部回复将被永久删除，确定继续吗？")
    ) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      await deleteForumThread(thread.id);
      router.push(APP_ROUTES.forum);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除帖子失败");
      setActionLoading(false);
    }
  }

  function startEditPost(postId: string, body: string) {
    setEditingPostId(postId);
    setPostDraft(body);
    setError(null);
  }

  async function savePost(postId: string) {
    setActionLoading(true);
    setError(null);

    try {
      const result = await updateForumPost(postId, { body: postDraft });
      setThread((current) =>
        current
          ? {
              ...current,
              posts: current.posts.map((post) =>
                post.id === postId ? result.post : post,
              ),
            }
          : current,
      );
      setEditingPostId(null);
      setPostDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存回复失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function removePost(postId: string, isFirstPost: boolean) {
    const message = isFirstPost
      ? "删除第一楼会永久删除整个帖子及其全部回复，确定继续吗？"
      : "确定删除这条回复吗？";

    if (!window.confirm(message)) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const result = await deleteForumPost(postId);

      if (result.deletedThread) {
        router.push(APP_ROUTES.forum);
        return;
      }

      setThread((current) => {
        if (!current) {
          return current;
        }

        const deletedIds = new Set([postId]);
        let changed = true;

        while (changed) {
          changed = false;
          for (const post of current.posts) {
            if (
              post.parentId &&
              deletedIds.has(post.parentId) &&
              !deletedIds.has(post.id)
            ) {
              deletedIds.add(post.id);
              changed = true;
            }
          }
        }

        return {
          ...current,
          postCount: Math.max(
            0,
            current.postCount - (result.deletedCount ?? deletedIds.size),
          ),
          posts: current.posts.filter((post) => !deletedIds.has(post.id)),
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除回复失败");
    } finally {
      setActionLoading(false);
    }
  }

  const statusText = thread?.status === "locked" ? "已锁定" : "开放";
  const postStructure = useMemo(() => {
    const posts = thread?.posts ?? [];
    const mainPost = posts[0] ?? null;
    const postIds = new Set(posts.map((post) => post.id));
    const comments: ForumPostSummary[] = [];
    const repliesByParent = new Map<string, ForumPostSummary[]>();

    for (const post of posts.slice(1)) {
      if (
        !post.parentId ||
        post.parentId === mainPost?.id ||
        !postIds.has(post.parentId)
      ) {
        comments.push(post);
        continue;
      }

      const replies = repliesByParent.get(post.parentId) ?? [];
      replies.push(post);
      repliesByParent.set(post.parentId, replies);
    }

    return { mainPost, comments, repliesByParent };
  }, [thread?.posts]);

  function renderNestedReplies(parentId: string, depth = 1): ReactNode {
    if (!thread) {
      return null;
    }

    const nestedReplies = postStructure.repliesByParent.get(parentId) ?? [];

    if (nestedReplies.length === 0) {
      return null;
    }

    return (
      <div
        className="forum-comment-replies"
        style={depth > 3 ? { borderLeft: 0, paddingLeft: 0 } : undefined}
      >
        {nestedReplies.map((replyPost) => (
          <article className="forum-reply-row" key={replyPost.id}>
            <ForumUserAvatar
              className="forum-comment-avatar small"
              isAnonymous={replyPost.isAnonymous}
              user={replyPost.author}
            />
            <div className="forum-comment-content">
              <div className="forum-post-toolbar">
                {renderCommentMeta(replyPost)}
                <span>
                  {replyPost.canDelete ? (
                    <button
                      className="icon-button subtle"
                      disabled={actionLoading}
                      onClick={() => removePost(replyPost.id, false)}
                      title="删除"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              </div>

              <div className="forum-post-body">
                <p>
                  {replyPost.replyTo &&
                  (depth > 3 || replyPost.replyToId !== parentId) ? (
                    <span className="forum-reply-target">
                      回复{" "}
                      {replyPost.replyTo.isAnonymous ? (
                        "匿名用户"
                      ) : (
                        <UserProfileLink
                          className="user-profile-link"
                          user={replyPost.replyTo.author}
                        />
                      )}
                      ：
                    </span>
                  ) : null}
                  {replyPost.body}
                </p>
              </div>
              <ForumPostImages compact images={replyPost.images} />

              {thread.canReply ? (
                <button
                  className="forum-text-button"
                  onClick={() =>
                    setActiveReplyPostId((current) =>
                      current === replyPost.id ? null : replyPost.id,
                    )
                  }
                  type="button"
                >
                  <MessageSquareReply aria-hidden="true" />
                  回复
                </button>
              ) : null}

              {activeReplyPostId === replyPost.id ? (
                <form
                  className="forum-nested-reply-form"
                  onSubmit={(event) => handleReply(event, replyPost.id)}
                >
                  <AutoTextarea
                    autoFocus
                    className="textarea"
                    maxLength={8000}
                    placeholder={`回复 ${replyPost.isAnonymous ? "匿名用户" : replyPost.author.displayName}`}
                    value={replyDrafts[replyPost.id] ?? ""}
                    onChange={(event) =>
                      setReplyDrafts((current) => ({
                        ...current,
                        [replyPost.id]: event.target.value,
                      }))
                    }
                  />
                  {renderImagePicker(replyPost.id)}
                  <div className="button-row forum-reply-actions">
                    <button
                      className="button secondary"
                      onClick={() => setActiveReplyPostId(null)}
                      type="button"
                    >
                      取消
                    </button>
                    {renderAnonymousOption(replyPost.id)}
                    <button
                      className="button"
                      disabled={
                        submitting ||
                        processingReplyImages[replyPost.id] ||
                        !(replyDrafts[replyPost.id] ?? "").trim()
                      }
                      type="submit"
                    >
                      <Send aria-hidden="true" className="button-icon" />
                      {submitting ? "发送中" : "回复"}
                    </button>
                  </div>
                </form>
              ) : null}

              {renderNestedReplies(replyPost.id, depth + 1)}
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="workspace forum-workspace">
      {error ? <p className="error-text">{error}</p> : null}

      {thread ? (
        <section className="forum-thread-detail surface">
          <header className="forum-thread-top">
            <div className="forum-thread-topline">
              <span>帖子状态</span>
              <em className={`forum-status-badge ${thread.status}`}>
                {thread.status === "locked" ? (
                  <Lock aria-hidden="true" />
                ) : null}
                {statusText}
              </em>
            </div>
            {editingThread ? (
              <form className="forum-thread-edit-form" onSubmit={saveThread}>
                <input
                  className="input"
                  maxLength={120}
                  value={threadTitleDraft}
                  onChange={(event) => setThreadTitleDraft(event.target.value)}
                />
                <select
                  className="select"
                  value={threadCategoryDraft}
                  onChange={(event) =>
                    setThreadCategoryDraft(event.target.value)
                  }
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <div className="button-row left">
                  <button
                    className="button"
                    disabled={actionLoading || !threadTitleDraft.trim()}
                    type="submit"
                  >
                    <Save aria-hidden="true" className="button-icon" />
                    保存
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setEditingThread(false)}
                    type="button"
                  >
                    <X aria-hidden="true" className="button-icon" />
                    取消
                  </button>
                </div>
              </form>
            ) : null}
            <div className="forum-thread-actions">
              {thread.canEdit && !editingThread ? (
                <button
                  className="button secondary"
                  disabled={actionLoading}
                  onClick={startEditThread}
                  type="button"
                >
                  <Pencil aria-hidden="true" className="button-icon" />
                  编辑帖子
                </button>
              ) : null}
              {thread.canModerate ? (
                thread.status === "locked" ? (
                  <button
                    className="button secondary"
                    disabled={actionLoading}
                    onClick={() => setThreadStatus("open")}
                    type="button"
                  >
                    <Unlock aria-hidden="true" className="button-icon" />
                    解锁
                  </button>
                ) : (
                  <button
                    className="button secondary"
                    disabled={actionLoading}
                    onClick={() => setThreadStatus("locked")}
                    type="button"
                  >
                    <Lock aria-hidden="true" className="button-icon" />
                    锁定
                  </button>
                )
              ) : null}
              {thread.canDelete ? (
                <button
                  className="button danger"
                  disabled={actionLoading}
                  onClick={deleteThread}
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="button-icon" />
                  删除帖子
                </button>
              ) : null}
            </div>
          </header>

          <div className="forum-post-list">
            {postStructure.mainPost ? (
              <article className="forum-post-row forum-main-post">
                <aside className="forum-post-author">
                  <ForumUserAvatar
                    className="forum-comment-avatar forum-main-author-avatar"
                    isAnonymous={postStructure.mainPost.isAnonymous}
                    user={postStructure.mainPost.author}
                  />
                  <strong>
                    {postStructure.mainPost.isAnonymous ? (
                      "匿名用户"
                    ) : (
                      <UserProfileLink
                        className="user-profile-link"
                        user={postStructure.mainPost.author}
                      />
                    )}
                  </strong>
                  {postStructure.mainPost.isAnonymous ? (
                    <span>
                      {postStructure.mainPost.author.id !== "anonymous" ? (
                        <>
                          真实身份：
                          <UserProfileLink
                            className="user-profile-link"
                            user={postStructure.mainPost.author}
                          />
                        </>
                      ) : (
                        "匿名"
                      )}
                    </span>
                  ) : null}
                </aside>
                <div className="forum-post-content">
                  <div className="forum-post-toolbar">
                    <time>
                      {formatRelativeTime(postStructure.mainPost.createdAt)}
                      {postStructure.mainPost.updatedAt !==
                      postStructure.mainPost.createdAt
                        ? " · 已编辑"
                        : ""}
                    </time>
                    <span>
                      {postStructure.mainPost.canEdit &&
                      editingPostId !== postStructure.mainPost.id ? (
                        <button
                          className="icon-button subtle"
                          disabled={actionLoading}
                          onClick={() =>
                            startEditPost(
                              postStructure.mainPost!.id,
                              postStructure.mainPost!.body,
                            )
                          }
                          title="编辑"
                          type="button"
                        >
                          <Pencil aria-hidden="true" />
                        </button>
                      ) : null}
                      {postStructure.mainPost.canDelete ? (
                        <button
                          className="icon-button subtle"
                          disabled={actionLoading}
                          onClick={() =>
                            removePost(postStructure.mainPost!.id, true)
                          }
                          title="删除"
                          type="button"
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {!editingThread ? (
                    <h1 className="forum-main-post-title">{thread.title}</h1>
                  ) : null}
                  {editingPostId === postStructure.mainPost.id ? (
                    <div className="forum-post-edit-form">
                      <AutoTextarea
                        className="textarea"
                        maxLength={8000}
                        value={postDraft}
                        onChange={(event) => setPostDraft(event.target.value)}
                      />
                      <div className="button-row left">
                        <button
                          className="button"
                          disabled={actionLoading || !postDraft.trim()}
                          onClick={() => savePost(postStructure.mainPost!.id)}
                          type="button"
                        >
                          <Save aria-hidden="true" className="button-icon" />
                          保存
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setEditingPostId(null);
                            setPostDraft("");
                          }}
                          type="button"
                        >
                          <X aria-hidden="true" className="button-icon" />
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="forum-post-body">
                      <p>{postStructure.mainPost.body}</p>
                    </div>
                  )}
                  <ForumPostImages images={postStructure.mainPost.images} />
                </div>
              </article>
            ) : null}

            <section className="forum-comment-section" aria-label="回复">
              <div className="forum-comment-head">
                <strong>回复</strong>
                <span>{postStructure.comments.length} 条</span>
              </div>

              {postStructure.comments.map((post) => {
                const draft = replyDrafts[post.id] ?? "";

                return (
                  <article className="forum-comment-row" key={post.id}>
                    <div className="forum-comment-main">
                      <ForumUserAvatar
                        className="forum-comment-avatar"
                        isAnonymous={post.isAnonymous}
                        user={post.author}
                      />
                      <div className="forum-comment-content">
                        <div className="forum-post-toolbar">
                          {renderCommentMeta(post)}
                          <span>
                            {post.canDelete ? (
                              <button
                                className="icon-button subtle"
                                disabled={actionLoading}
                                onClick={() => removePost(post.id, false)}
                                title="删除"
                                type="button"
                              >
                                <Trash2 aria-hidden="true" />
                              </button>
                            ) : null}
                          </span>
                        </div>

                        <div className="forum-post-body">
                          <p>{post.body}</p>
                        </div>
                        <ForumPostImages compact images={post.images} />

                        {thread.canReply ? (
                          <button
                            className="forum-text-button"
                            onClick={() =>
                              setActiveReplyPostId((current) =>
                                current === post.id ? null : post.id,
                              )
                            }
                            type="button"
                          >
                            <MessageSquareReply aria-hidden="true" />
                            回复
                          </button>
                        ) : null}

                        {activeReplyPostId === post.id ? (
                          <form
                            className="forum-nested-reply-form"
                            onSubmit={(event) => handleReply(event, post.id)}
                          >
                            <AutoTextarea
                              autoFocus
                              className="textarea"
                              maxLength={8000}
                              placeholder={`回复 ${post.isAnonymous ? "匿名用户" : post.author.displayName}`}
                              value={draft}
                              onChange={(event) =>
                                setReplyDrafts((current) => ({
                                  ...current,
                                  [post.id]: event.target.value,
                                }))
                              }
                            />
                            {renderImagePicker(post.id)}
                            <div className="button-row forum-reply-actions">
                              <button
                                className="button secondary"
                                onClick={() => setActiveReplyPostId(null)}
                                type="button"
                              >
                                取消
                              </button>
                              {renderAnonymousOption(post.id)}
                              <button
                                className="button"
                                disabled={
                                  submitting ||
                                  processingReplyImages[post.id] ||
                                  !draft.trim()
                                }
                                type="submit"
                              >
                                <Send
                                  aria-hidden="true"
                                  className="button-icon"
                                />
                                {submitting ? "发送中" : "回复"}
                              </button>
                            </div>
                          </form>
                        ) : null}

                        {renderNestedReplies(post.id)}
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          </div>

          {thread.canReply ? (
            <form className="forum-reply-form" onSubmit={handleReply}>
              <label className="label">
                <span>
                  <MessageSquareReply
                    aria-hidden="true"
                    className="heading-icon"
                  />
                  写回复
                </span>
                <AutoTextarea
                  className="textarea"
                  maxLength={8000}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
              </label>
              {renderImagePicker("root")}
              <div className="button-row forum-reply-actions">
                {renderAnonymousOption("root")}
                <button
                  className="button"
                  disabled={
                    submitting || processingReplyImages.root || !reply.trim()
                  }
                  type="submit"
                >
                  <Send aria-hidden="true" className="button-icon" />
                  {submitting ? "发送中" : "回复"}
                </button>
              </div>
            </form>
          ) : (
            <div className="forum-inline-notice">
              <Lock aria-hidden="true" />
              帖子已锁定，暂不能继续回复。
            </div>
          )}
        </section>
      ) : !loading ? (
        <section className="empty-panel surface">
          <strong>没有找到这个帖子</strong>
          <span>帖子可能已被删除，或链接已经失效。</span>
          <Link className="button secondary" href={APP_ROUTES.forum}>
            返回论坛
          </Link>
        </section>
      ) : null}
    </div>
  );
}
