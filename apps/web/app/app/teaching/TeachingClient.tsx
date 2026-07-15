"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Play, Plus, Search, Trash2 } from "lucide-react";
import type { TeachingDeckSummary } from "@liveboard/shared";
import { deleteTeachingDeck, listTeachingDecks } from "@/lib/api";
import { formatDateTime } from "@/lib/labels";
import { APP_ROUTES, teachingEdit, teachingPresent } from "@/lib/routes";

export function TeachingClient() {
  const [decks, setDecks] = useState<TeachingDeckSummary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      );
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
        <div className="panel-head">
          <h2>课件</h2>
          <Link className="button" href={APP_ROUTES.teachingNew}>
            <Plus aria-hidden="true" className="button-icon" />
            创建课件
          </Link>
        </div>
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
        </div>
        <div className="teaching-deck-list">
          {filtered.map((deck) => (
            <article className="teaching-deck-row" key={deck.id}>
              <div className="teaching-deck-main">
                <Link href={teachingPresent(deck.id)}>{deck.title}</Link>
                <span>
                  {deck.itemCount} 个内容块 · {deck.createdBy.displayName} ·
                  更新于 {formatDateTime(deck.updatedAt)}
                </span>
              </div>
              <div className="teaching-deck-actions">
                <Link
                  className="button secondary"
                  href={teachingPresent(deck.id)}
                >
                  <Play aria-hidden="true" className="button-icon" />
                  展示
                </Link>
                {deck.canEdit ? (
                  <details className="editor-more-menu">
                    <summary
                      className="icon-button subtle"
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
          {filtered.length === 0 ? (
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
