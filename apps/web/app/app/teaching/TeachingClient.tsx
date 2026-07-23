"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import type { TeachingDeckSummary } from "@liveboard/shared";
import { deleteTeachingDeck, listTeachingDecks } from "@/lib/api";
import { UserProfileLink } from "@/components/UserProfileLink";
import { formatRelativeTime } from "@/lib/labels";
import { APP_ROUTES, teachingEdit, teachingPresent } from "@/lib/routes";
import { SkeletonRows } from "@/components/system/ProgressiveLoading";

export function TeachingClient() {
  const router = useRouter();
  const [decks, setDecks] = useState<TeachingDeckSummary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingDecks, setLoadingDecks] = useState(true);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value
      ? decks.filter((deck) =>
          `${deck.title} ${deck.createdBy.displayName}`
            .toLowerCase()
            .includes(value),
        )
      : decks;
  }, [decks, query]);

  useEffect(() => {
    listTeachingDecks()
      .then((result) => setDecks(result.decks))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载课件失败"),
      )
      .finally(() => setLoadingDecks(false));
  }, []);

  async function onDelete(deck: TeachingDeckSummary) {
    if (!window.confirm(`确定删除课件“${deck.title}”吗？`)) return;
    try {
      await deleteTeachingDeck(deck.id);
      setDecks((current) => current.filter((item) => item.id !== deck.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除课件失败");
    }
  }

  return (
    <div className="workspace teaching-workspace">
      <header className="page-head compact">
        <div>
          <p className="page-eyebrow">教学活动</p>
          <h1>课件</h1>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="workbench-main teaching-list-panel">
        <div className="list-toolbar">
          <label className="search-field">
            <Search aria-hidden="true" />
            <input
              aria-label="搜索课件"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索课件或创建者"
              value={query}
            />
          </label>
          <Link className="button" href={APP_ROUTES.teachingNew}>
            <Plus aria-hidden="true" className="button-icon" />
            创建课件
          </Link>
        </div>
        <div className="teaching-deck-list">
          {loadingDecks ? <SkeletonRows count={5} /> : null}
          {filtered.map((deck) => (
            <article
              className="teaching-deck-row teaching-deck-row-link"
              key={deck.id}
              onClick={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("a, button, summary")
                ) {
                  return;
                }
                router.push(teachingPresent(deck.id));
              }}
            >
              <div className="teaching-deck-main">
                <Link
                  className={deck.viaSuperAdmin ? "rainbow-text" : undefined}
                  href={teachingPresent(deck.id)}
                  title={deck.viaSuperAdmin ? "仅最高管理员可见" : undefined}
                >
                  {deck.title}
                </Link>
                <span>
                  <UserProfileLink
                    className="user-profile-link"
                    user={deck.createdBy}
                  />{" "}
                  · 更新于 {formatRelativeTime(deck.updatedAt)}
                </span>
              </div>
              <div className="teaching-deck-actions">
                {deck.canEdit ? (
                  <details className="editor-more-menu">
                    <summary
                      className="icon-button subtle row-more-button"
                      title="更多课件操作"
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </summary>
                    <div className="context-menu">
                      <Link href={teachingEdit(deck.id)}>编辑课件</Link>
                      <button onClick={() => void onDelete(deck)} type="button">
                        <Trash2 aria-hidden="true" className="button-icon" />
                        删除课件
                      </button>
                    </div>
                  </details>
                ) : null}
              </div>
            </article>
          ))}
          {!loadingDecks && filtered.length === 0 ? (
            <div className="empty-panel teaching-empty">
              <strong>{decks.length ? "没有匹配的课件" : "暂无课件"}</strong>
              <span>
                {decks.length
                  ? "换一个关键词搜索。"
                  : "从文档中选择段落，拼成第一份课件。"}
              </span>
              {!decks.length ? (
                <Link
                  className="button secondary"
                  href={APP_ROUTES.teachingNew}
                >
                  创建课件
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
