"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Plus, Search } from "lucide-react";
import type {
  ForumCategorySummary,
  ForumThreadSummary,
} from "@liveboard/shared";
import { listForumOverview } from "@/lib/api";
import { formatRelativeTime } from "@/lib/labels";
import { APP_ROUTES, forumThread } from "@/lib/routes";
import { SortIconSelect } from "@/components/SortIconSelect";
import { UserProfileLink } from "@/components/UserProfileLink";
import { ForumUserAvatar } from "./ForumUserAvatar";

type CategoryFilter = "all" | string;
type SortMode = "activity" | "newest" | "replies";
type FeedFilter = "all" | "unread" | "mentioned" | "followed";

const SORT_OPTIONS = [
  { value: "activity", label: "最近活跃" },
  { value: "newest", label: "最新发布" },
  { value: "replies", label: "回复最多" },
] as const;

export function ForumClient() {
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [threads, setThreads] = useState<ForumThreadSummary[]>([]);
  const [activeCategoryId, setActiveCategoryId] =
    useState<CategoryFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("activity");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    listForumOverview()
      .then((result) => {
        if (!mounted) return;
        setCategories(result.categories);
        setThreads(result.threads);
      })
      .catch((caught) => {
        if (mounted) {
          setError(caught instanceof Error ? caught.message : "加载论坛失败");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const filteredThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return threads
      .filter((thread) => {
        const matchesCategory =
          activeCategoryId === "all" || thread.categoryId === activeCategoryId;
        const matchesFeed =
          feedFilter === "all" ||
          (feedFilter === "unread" && thread.unread) ||
          (feedFilter === "mentioned" && thread.mentioned) ||
          (feedFilter === "followed" && thread.followed);
        const matchesQuery = normalizedQuery
          ? thread.title.toLowerCase().includes(normalizedQuery) ||
            thread.excerpt.toLowerCase().includes(normalizedQuery) ||
            thread.author.displayName.toLowerCase().includes(normalizedQuery) ||
            thread.author.username.toLowerCase().includes(normalizedQuery)
          : true;
        return matchesCategory && matchesFeed && matchesQuery;
      })
      .sort((left, right) => {
        if (sortMode === "replies") {
          return right.postCount - left.postCount;
        }
        const leftTime = new Date(
          sortMode === "newest" ? left.createdAt : left.lastActivityAt,
        ).getTime();
        const rightTime = new Date(
          sortMode === "newest" ? right.createdAt : right.lastActivityAt,
        ).getTime();
        return rightTime - leftTime;
      });
  }, [activeCategoryId, feedFilter, query, sortMode, threads]);

  const hasFilters =
    activeCategoryId !== "all" || feedFilter !== "all" || Boolean(query.trim());

  function resetFilters() {
    setActiveCategoryId("all");
    setFeedFilter("all");
    setQuery("");
  }

  return (
    <div className="workspace forum-workspace forum-home">
      <header className="forum-page-header">
        <div>
          <h1>论坛</h1>
          <p>{threads.length} 个帖子</p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="forum-shell" aria-label="论坛工作区">
        <section className="forum-feed">
          <div className="forum-feed-head forum-feed-toolbar">
            <label className="search-field forum-search">
              <Search aria-hidden="true" />
              <input
                aria-label="搜索论坛"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、内容或作者"
                value={query}
              />
            </label>
            <div
              className="segmented-control forum-feed-filter"
              aria-label="帖子范围"
            >
              {(
                [
                  ["all", "全部"],
                  ["unread", "未读"],
                  ["mentioned", "提及"],
                  ["followed", "关注"],
                ] as const
              ).map(([value, label]) => (
                <button
                  className={feedFilter === value ? "active" : ""}
                  key={value}
                  onClick={() => setFeedFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              aria-label="选择版块"
              className="select compact-select"
              value={activeCategoryId}
              onChange={(event) => setActiveCategoryId(event.target.value)}
            >
              <option value="all">全部帖子（{threads.length}）</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}（{category.threadCount}）
                </option>
              ))}
            </select>
            <SortIconSelect
              className="forum-sort-control"
              onChange={setSortMode}
              options={SORT_OPTIONS}
              value={sortMode}
            />
            <Link
              className="button forum-create-action"
              href={APP_ROUTES.forumNew}
            >
              <Plus aria-hidden="true" className="button-icon" />
              <span className="forum-create-label">发帖</span>
            </Link>
          </div>

          <div className="forum-thread-list">
            {loading
              ? Array.from({ length: 4 }, (_, index) => (
                  <div className="forum-thread-skeleton" key={index} />
                ))
              : null}
            {filteredThreads.map((thread) => {
              const category = categoryById.get(thread.categoryId);
              const replyCount = Math.max(0, thread.postCount - 1);
              return (
                <article
                  className="forum-topic forum-topic-link"
                  key={thread.id}
                  onClick={(event) => {
                    if (
                      event.target instanceof HTMLElement &&
                      event.target.closest("a, button")
                    ) {
                      return;
                    }
                    window.open(
                      forumThread(thread.id),
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  <ForumUserAvatar
                    className="forum-topic-avatar"
                    isAnonymous={thread.isAnonymous}
                    user={thread.author}
                  />
                  <span className="forum-topic-content">
                    <span className="forum-topic-meta">
                      {thread.isAnonymous ? (
                        <span>匿名用户</span>
                      ) : (
                        <UserProfileLink
                          className="user-profile-link"
                          user={thread.author}
                        />
                      )}
                      {thread.isAnonymous &&
                      thread.author.id !== "anonymous" ? (
                        <span className="forum-anonymous-reveal">
                          真实身份：
                          <UserProfileLink
                            className="user-profile-link"
                            user={thread.author}
                          />
                        </span>
                      ) : null}
                      <span className="forum-topic-footer">
                        <MessageSquare aria-hidden="true" />
                        {replyCount} 条回复
                        <span aria-hidden="true">·</span>
                        <span>{formatRelativeTime(thread.lastActivityAt)}</span>
                      </span>
                    </span>
                    <strong className="forum-topic-title">
                      <span className="forum-category-tag">
                        {category?.name ?? "未分类"}
                      </span>
                      {thread.status === "locked" ? (
                        <span className="forum-lock-tag">已锁定</span>
                      ) : null}
                      {thread.unread ? (
                        <span className="forum-unread-tag">未读</span>
                      ) : null}
                      {thread.mentioned ? (
                        <span className="forum-mention-tag">提及你</span>
                      ) : null}
                      <Link
                        href={forumThread(thread.id)}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {thread.title}
                      </Link>
                    </strong>
                    {thread.excerpt ? <p>{thread.excerpt}</p> : null}
                  </span>
                </article>
              );
            })}

            {!loading && filteredThreads.length === 0 ? (
              <div className="empty-panel">
                <strong>
                  {threads.length === 0 ? "论坛还没有帖子" : "没有匹配的帖子"}
                </strong>
                <span>
                  {threads.length === 0
                    ? "发第一个帖子，开始交流。"
                    : "调整搜索词或筛选条件。"}
                </span>
                {hasFilters ? (
                  <button
                    className="button secondary"
                    onClick={resetFilters}
                    type="button"
                  >
                    清除筛选
                  </button>
                ) : (
                  <Link className="button secondary" href={APP_ROUTES.forumNew}>
                    发帖
                  </Link>
                )}
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </div>
  );
}
