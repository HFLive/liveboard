"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Archive, Lock, MessageSquare, Plus, Search } from "lucide-react";
import type {
  ForumCategorySummary,
  ForumThreadSummary,
} from "@liveboard/shared";
import { listForumOverview } from "@/lib/api";
import { APP_ROUTES, forumThread } from "@/lib/routes";

type CategoryFilter = "all" | string;
type StatusFilter = "all" | "open" | "locked" | "archived";
type SortMode = "activity" | "newest" | "replies";

const relativeTime = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

function formatRelativeTime(value: string) {
  const difference = new Date(value).getTime() - Date.now();
  const minutes = Math.round(difference / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return relativeTime.format(days, "day");
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function ForumClient() {
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [threads, setThreads] = useState<ForumThreadSummary[]>([]);
  const [activeCategoryId, setActiveCategoryId] =
    useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("activity");
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
  const activeCategory =
    activeCategoryId === "all"
      ? null
      : (categoryById.get(activeCategoryId) ?? null);

  const filteredThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return threads
      .filter((thread) => {
        const matchesCategory =
          activeCategoryId === "all" || thread.categoryId === activeCategoryId;
        const matchesStatus =
          statusFilter === "all" || thread.status === statusFilter;
        const matchesQuery = normalizedQuery
          ? thread.title.toLowerCase().includes(normalizedQuery) ||
            thread.excerpt.toLowerCase().includes(normalizedQuery) ||
            thread.author.displayName.toLowerCase().includes(normalizedQuery) ||
            thread.author.username.toLowerCase().includes(normalizedQuery)
          : true;
        return matchesCategory && matchesStatus && matchesQuery;
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
  }, [activeCategoryId, query, sortMode, statusFilter, threads]);

  const hasFilters =
    activeCategoryId !== "all" ||
    statusFilter !== "all" ||
    Boolean(query.trim());

  function resetFilters() {
    setActiveCategoryId("all");
    setStatusFilter("all");
    setQuery("");
  }

  return (
    <div className="workspace forum-workspace forum-home">
      <header className="forum-page-header">
        <div>
          <h1>论坛</h1>
          <p>{threads.length} 个主题</p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="forum-shell" aria-label="论坛工作区">
        <nav className="forum-category-panel" aria-label="论坛版块">
          <div className="forum-panel-title">
            <h2>版块</h2>
          </div>
          <div className="forum-category-list">
            <button
              className={`forum-category-button ${activeCategoryId === "all" ? "active" : ""}`}
              onClick={() => setActiveCategoryId("all")}
              type="button"
            >
              <span>
                <strong>全部主题</strong>
                <small>浏览论坛中的所有内容</small>
              </span>
              <em>{threads.length}</em>
            </button>
            {categories.map((category) => (
              <button
                className={`forum-category-button ${activeCategoryId === category.id ? "active" : ""}`}
                key={category.id}
                onClick={() => setActiveCategoryId(category.id)}
                type="button"
              >
                <span>
                  <strong>{category.name}</strong>
                  <small>{category.description ?? "暂无说明"}</small>
                </span>
                <em>{category.threadCount}</em>
              </button>
            ))}
          </div>
        </nav>

        <section className="forum-feed">
          <div className="forum-feed-head forum-feed-toolbar">
            <div className="forum-feed-title">
              <h2>{activeCategory?.name ?? "全部主题"}</h2>
              <span>
                {loading ? "正在加载" : `${filteredThreads.length} 个结果`}
              </span>
            </div>
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
              className="segmented-control forum-status-filter"
              aria-label="主题状态"
            >
              {(
                [
                  ["all", "全部"],
                  ["open", "开放"],
                  ["locked", "锁定"],
                  ["archived", "归档"],
                ] as const
              ).map(([value, label]) => (
                <button
                  className={statusFilter === value ? "active" : ""}
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="forum-sort-control">
              <span>排序</span>
              <select
                className="select"
                onChange={(event) =>
                  setSortMode(event.target.value as SortMode)
                }
                value={sortMode}
              >
                <option value="activity">最近活跃</option>
                <option value="newest">最新发布</option>
                <option value="replies">回复最多</option>
              </select>
            </label>
            <Link
              className="button forum-create-action"
              href={APP_ROUTES.forumNew}
            >
              <Plus aria-hidden="true" className="button-icon" />
              发布主题
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
                <Link
                  className="forum-topic"
                  href={forumThread(thread.id)}
                  key={thread.id}
                >
                  <span className="forum-topic-avatar" aria-hidden="true">
                    {thread.author.displayName.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="forum-topic-content">
                    <span className="forum-topic-meta">
                      <b>{category?.name ?? "未分类"}</b>
                      <span>·</span>
                      <span>{thread.author.displayName}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(thread.lastActivityAt)}</span>
                      {thread.status !== "open" ? (
                        <span className={`forum-list-status ${thread.status}`}>
                          {thread.status === "locked" ? (
                            <Lock aria-hidden="true" />
                          ) : (
                            <Archive aria-hidden="true" />
                          )}
                          {thread.status === "locked" ? "已锁定" : "已归档"}
                        </span>
                      ) : null}
                    </span>
                    <strong className="forum-topic-title">
                      {thread.title}
                    </strong>
                    {thread.excerpt ? <p>{thread.excerpt}</p> : null}
                    <span className="forum-topic-footer">
                      <MessageSquare aria-hidden="true" />
                      {replyCount} 条回复
                    </span>
                  </span>
                </Link>
              );
            })}

            {!loading && filteredThreads.length === 0 ? (
              <div className="empty-panel">
                <strong>
                  {threads.length === 0 ? "论坛还没有主题" : "没有匹配的主题"}
                </strong>
                <span>
                  {threads.length === 0
                    ? "发布第一个主题，开始交流。"
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
                    发布主题
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
