"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Archive,
  ArrowLeft,
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
  updateForumPost,
  updateForumThread,
} from "@/lib/api";
import { formatDateTime } from "@/lib/labels";
import { APP_ROUTES } from "@/lib/routes";

interface ForumThreadClientProps {
  threadId: string;
}

export function ForumThreadClient({ threadId }: ForumThreadClientProps) {
  const router = useRouter();
  const [thread, setThread] = useState<ForumThreadDetail | null>(null);
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [reply, setReply] = useState("");
  const [activeReplyPostId, setActiveReplyPostId] = useState<string | null>(
    null,
  );
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
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

    try {
      const result = await createForumPost(threadId, { body, parentId });

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

      setThread((current) =>
        current
          ? {
              ...current,
              posts: [...current.posts, result.post],
              postCount: current.postCount + 1,
              lastActivityAt: result.post.createdAt,
              updatedAt: result.post.createdAt,
            }
          : current,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "回复失败");
    } finally {
      setSubmitting(false);
    }
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

  async function restoreThread() {
    await setThreadStatus("open");
  }

  async function archiveThread() {
    if (
      !thread ||
      !window.confirm("归档后普通成员将看不到这个帖子，确定继续吗？")
    ) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      await deleteForumThread(thread.id);
      router.push(APP_ROUTES.forum);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "归档帖子失败");
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
      ? "删除第一楼会归档整个帖子，确定继续吗？"
      : "确定删除这条回复吗？";

    if (!window.confirm(message)) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const result = await deleteForumPost(postId);

      if (result.archivedThread) {
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

  const replyCount = thread ? Math.max(0, thread.postCount - 1) : 0;
  const statusText =
    thread?.status === "locked"
      ? "已锁定"
      : thread?.status === "archived"
        ? "已归档"
        : "开放";
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
            <div className="forum-comment-avatar small" aria-hidden="true">
              {replyPost.author.displayName.slice(0, 1)}
            </div>
            <div className="forum-comment-content">
              <div className="forum-post-toolbar">
                <span className="forum-comment-meta">
                  <strong>{replyPost.author.displayName}</strong>
                  <small>
                    @{replyPost.author.username} ·{" "}
                    {formatDateTime(replyPost.createdAt)}
                    {replyPost.updatedAt !== replyPost.createdAt
                      ? " · 已编辑"
                      : ""}
                  </small>
                </span>
                <span>
                  {replyPost.canEdit && editingPostId !== replyPost.id ? (
                    <button
                      className="icon-button subtle"
                      disabled={actionLoading}
                      onClick={() =>
                        startEditPost(replyPost.id, replyPost.body)
                      }
                      title="编辑"
                      type="button"
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                  ) : null}
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

              {editingPostId === replyPost.id ? (
                <div className="forum-post-edit-form">
                  <textarea
                    className="textarea"
                    maxLength={8000}
                    value={postDraft}
                    onChange={(event) => setPostDraft(event.target.value)}
                  />
                  <div className="button-row left">
                    <button
                      className="button"
                      disabled={actionLoading || !postDraft.trim()}
                      onClick={() => savePost(replyPost.id)}
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
                  <p>
                    {depth > 1 && replyPost.replyTo ? (
                      <span className="forum-reply-target">
                        回复 {replyPost.replyTo.author.displayName}（@
                        {replyPost.replyTo.author.username}）：
                      </span>
                    ) : null}
                    {replyPost.body}
                  </p>
                </div>
              )}

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
                  <textarea
                    autoFocus
                    className="textarea"
                    maxLength={8000}
                    placeholder={`回复 ${replyPost.author.displayName}`}
                    value={replyDrafts[replyPost.id] ?? ""}
                    onChange={(event) =>
                      setReplyDrafts((current) => ({
                        ...current,
                        [replyPost.id]: event.target.value,
                      }))
                    }
                  />
                  <div className="button-row">
                    <button
                      className="button secondary"
                      onClick={() => setActiveReplyPostId(null)}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="button"
                      disabled={
                        submitting || !(replyDrafts[replyPost.id] ?? "").trim()
                      }
                      type="submit"
                    >
                      <Send aria-hidden="true" className="button-icon" />
                      {submitting ? "发送中" : "发送回复"}
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
      <Link className="page-back-link" href={APP_ROUTES.forum}>
        <ArrowLeft aria-hidden="true" />
        返回论坛
      </Link>
      <section className="page-head">
        <div>
          <p className="page-eyebrow">{thread?.category.name ?? "论坛"}</p>
          <h1>{thread?.title ?? "帖子详情"}</h1>
          <p className="muted">
            {thread
              ? `${thread.author.displayName} · 创建于 ${formatDateTime(thread.createdAt)} · 最近活跃 ${formatDateTime(thread.lastActivityAt)}`
              : "正在加载帖子内容与回复。"}
          </p>
        </div>
      </section>

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
                {thread.status === "archived" ? (
                  <Archive aria-hidden="true" />
                ) : null}
                {statusText}
              </em>
              <div className="forum-thread-summary">
                <strong>{replyCount}</strong>
                <span>回复</span>
              </div>
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
                thread.status === "archived" ? (
                  <button
                    className="button secondary"
                    disabled={actionLoading}
                    onClick={restoreThread}
                    type="button"
                  >
                    <Unlock aria-hidden="true" className="button-icon" />
                    恢复
                  </button>
                ) : thread.status === "locked" ? (
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
              {thread.canArchive ? (
                <button
                  className="button danger"
                  disabled={actionLoading}
                  onClick={archiveThread}
                  type="button"
                >
                  <Archive aria-hidden="true" className="button-icon" />
                  归档
                </button>
              ) : null}
            </div>
          </header>

          <div className="forum-post-list">
            {postStructure.mainPost ? (
              <article className="forum-post-row forum-main-post">
                <aside className="forum-post-author">
                  <strong>{postStructure.mainPost.author.displayName}</strong>
                  <span>@{postStructure.mainPost.author.username}</span>
                  <em>楼主</em>
                </aside>
                <div className="forum-post-content">
                  <div className="forum-post-toolbar">
                    <time>
                      {formatDateTime(postStructure.mainPost.createdAt)}
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
                  {editingPostId === postStructure.mainPost.id ? (
                    <div className="forum-post-edit-form">
                      <textarea
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
                      <div className="forum-comment-avatar" aria-hidden="true">
                        {post.author.displayName.slice(0, 1)}
                      </div>
                      <div className="forum-comment-content">
                        <div className="forum-post-toolbar">
                          <span className="forum-comment-meta">
                            <strong>{post.author.displayName}</strong>
                            <small>
                              @{post.author.username} ·{" "}
                              {formatDateTime(post.createdAt)}
                              {post.updatedAt !== post.createdAt
                                ? " · 已编辑"
                                : ""}
                            </small>
                          </span>
                          <span>
                            {post.canEdit && editingPostId !== post.id ? (
                              <button
                                className="icon-button subtle"
                                disabled={actionLoading}
                                onClick={() =>
                                  startEditPost(post.id, post.body)
                                }
                                title="编辑"
                                type="button"
                              >
                                <Pencil aria-hidden="true" />
                              </button>
                            ) : null}
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

                        {editingPostId === post.id ? (
                          <div className="forum-post-edit-form">
                            <textarea
                              className="textarea"
                              maxLength={8000}
                              value={postDraft}
                              onChange={(event) =>
                                setPostDraft(event.target.value)
                              }
                            />
                            <div className="button-row left">
                              <button
                                className="button"
                                disabled={actionLoading || !postDraft.trim()}
                                onClick={() => savePost(post.id)}
                                type="button"
                              >
                                <Save
                                  aria-hidden="true"
                                  className="button-icon"
                                />
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
                            <p>{post.body}</p>
                          </div>
                        )}

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
                            <textarea
                              autoFocus
                              className="textarea"
                              maxLength={8000}
                              placeholder={`回复 ${post.author.displayName}`}
                              value={draft}
                              onChange={(event) =>
                                setReplyDrafts((current) => ({
                                  ...current,
                                  [post.id]: event.target.value,
                                }))
                              }
                            />
                            <div className="button-row">
                              <button
                                className="button secondary"
                                onClick={() => setActiveReplyPostId(null)}
                                type="button"
                              >
                                取消
                              </button>
                              <button
                                className="button"
                                disabled={submitting || !draft.trim()}
                                type="submit"
                              >
                                <Send
                                  aria-hidden="true"
                                  className="button-icon"
                                />
                                {submitting ? "发送中" : "发送回复"}
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
                <textarea
                  className="textarea"
                  maxLength={8000}
                  placeholder="补充你的看法、解法或追问"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
              </label>
              <div className="button-row">
                <button
                  className="button"
                  disabled={submitting || !reply.trim()}
                  type="submit"
                >
                  <Send aria-hidden="true" className="button-icon" />
                  {submitting ? "发送中" : "发布回复"}
                </button>
              </div>
            </form>
          ) : (
            <div className="forum-inline-notice">
              {thread.status === "archived" ? (
                <Archive aria-hidden="true" />
              ) : (
                <Lock aria-hidden="true" />
              )}
              {thread.status === "archived"
                ? "帖子已归档，仅管理员可查看和恢复。"
                : "帖子已锁定，暂不能继续回复。"}
            </div>
          )}
        </section>
      ) : !loading ? (
        <section className="empty-panel surface">
          <strong>没有找到这个帖子</strong>
          <span>可能已被归档，或链接已经失效。</span>
          <Link className="button secondary" href={APP_ROUTES.forum}>
            返回论坛
          </Link>
        </section>
      ) : null}
    </div>
  );
}
