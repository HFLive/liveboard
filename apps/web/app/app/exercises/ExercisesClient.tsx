"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Plus, Search } from "lucide-react";
import { ExerciseSetSummary, listExerciseSets } from "@/lib/api";
import {
  formatDateTime,
  formatRelativeTime,
  submissionStatusLabel,
} from "@/lib/labels";
import { APP_ROUTES, exerciseDetail, exerciseSubmissions } from "@/lib/routes";
import { UserProfileLink } from "@/components/UserProfileLink";

type ExerciseFilter = "all" | "not_started" | "submitted" | "graded";

export function ExercisesClient() {
  const router = useRouter();
  const [exerciseSets, setExerciseSets] = useState<ExerciseSetSummary[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExerciseFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const filteredExerciseSets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return exerciseSets.filter((exercise) => {
      const matchesQuery = normalizedQuery
        ? exercise.title.toLowerCase().includes(normalizedQuery)
        : true;
      const matchesFilter =
        filter === "all" ||
        (filter === "submitted" &&
          ["submitted", "auto_graded", "needs_manual_review"].includes(
            exercise.latestSubmissionStatus,
          )) ||
        (filter === "graded" && exercise.latestSubmissionStatus === "graded") ||
        (filter === "not_started" &&
          exercise.latestSubmissionStatus === "not_started");

      return matchesQuery && matchesFilter;
    });
  }, [exerciseSets, filter, query]);

  useEffect(() => {
    listExerciseSets()
      .then((result) => setExerciseSets(result.exerciseSets))
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载练习失败");
      });
  }, []);

  return (
    <div className="workspace exercises-workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">教学活动</p>
          <h1>练习</h1>
          <p className="muted">创建练习、跟踪提交进度并处理待批改内容。</p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="workbench-main">
        <div className="list-toolbar">
          <label className="search-field">
            <Search aria-hidden="true" />
            <input
              placeholder="搜索练习"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="exercise-toolbar-actions">
            <div className="segmented-control" aria-label="练习状态筛选">
              <button
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
                type="button"
              >
                全部
              </button>
              <button
                className={filter === "not_started" ? "active" : ""}
                onClick={() => setFilter("not_started")}
                type="button"
              >
                未开始
              </button>
              <button
                className={filter === "submitted" ? "active" : ""}
                onClick={() => setFilter("submitted")}
                type="button"
              >
                待处理
              </button>
              <button
                className={filter === "graded" ? "active" : ""}
                onClick={() => setFilter("graded")}
                type="button"
              >
                已批改
              </button>
            </div>
            <Link className="button" href={APP_ROUTES.exercisesNew}>
              <Plus aria-hidden="true" className="button-icon" />
              创建练习
            </Link>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th>练习</th>
                <th>状态</th>
                <th>开放时间</th>
                <th>得分</th>
                <th>提交情况</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredExerciseSets.map((exercise) => (
                <tr
                  className="exercise-row-link"
                  key={exercise.id}
                  onClick={(event) => {
                    if (
                      event.target instanceof HTMLElement &&
                      event.target.closest("a, button")
                    ) {
                      return;
                    }
                    router.push(exerciseDetail(exercise.id));
                  }}
                >
                  <td data-label="练习">
                    <div className="exercise-title-cell">
                      <Link
                        className={
                          exercise.viaSuperAdmin ? "rainbow-text" : undefined
                        }
                        href={exerciseDetail(exercise.id)}
                        title={
                          exercise.viaSuperAdmin
                            ? "仅最高管理员可见"
                            : undefined
                        }
                      >
                        {exercise.title}
                      </Link>
                      <small>
                        <UserProfileLink
                          className="user-profile-link"
                          user={exercise.createdBy}
                        />{" "}
                        · {exercise.questionCount} 道题 · 更新于{" "}
                        {formatRelativeTime(exercise.updatedAt)}
                      </small>
                    </div>
                  </td>
                  <td data-label="状态">
                    {submissionStatusLabel(exercise.latestSubmissionStatus)}
                  </td>
                  <td data-label="开放时间">
                    <div className="schedule-cell">
                      <span>开始 {formatDateTime(exercise.openAt)}</span>
                      <span>截止 {formatDateTime(exercise.dueAt)}</span>
                    </div>
                  </td>
                  <td data-label="得分">
                    {exercise.latestScore === null || exercise.maxScore === null
                      ? "-"
                      : `${exercise.latestScore}/${exercise.maxScore}`}
                  </td>
                  <td data-label="提交情况">
                    {exercise.canManage ? (
                      <div className="submission-count-cell">
                        <span>{exercise.submissionCount} 份提交</span>
                        <small>{exercise.pendingReviewCount} 份待批改</small>
                      </div>
                    ) : exercise.latestSubmissionStatus === "not_started" ? (
                      "尚未提交"
                    ) : (
                      "已提交"
                    )}
                  </td>
                  <td data-label="操作">
                    <div className="table-actions compact">
                      {exercise.canManage ? (
                        <Link
                          className="table-action"
                          href={exerciseSubmissions(exercise.id)}
                        >
                          <ClipboardCheck
                            aria-hidden="true"
                            className="button-icon"
                          />
                          批改
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredExerciseSets.length === 0 ? (
                <tr className="exercise-empty-row">
                  <td className="empty-cell" colSpan={6}>
                    <div className="empty-panel">
                      <strong>
                        {exerciseSets.length === 0
                          ? "暂无练习"
                          : "没有匹配的练习"}
                      </strong>
                      <span>
                        {exerciseSets.length === 0
                          ? "可以从练习集文件创建第一份练习。"
                          : "换一个关键词或状态筛选。"}
                      </span>
                      {exerciseSets.length === 0 ? (
                        <Link
                          className="button secondary"
                          href={APP_ROUTES.exercisesNew}
                        >
                          <Plus aria-hidden="true" className="button-icon" />
                          创建练习
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
