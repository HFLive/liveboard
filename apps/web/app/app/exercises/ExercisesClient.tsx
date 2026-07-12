"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, ClipboardList, Plus, Search } from "lucide-react";
import { ExerciseSetSummary, listExerciseSets } from "@/lib/api";
import { formatDateTime, submissionStatusLabel } from "@/lib/labels";
import { APP_ROUTES, exerciseDetail, exerciseSubmissions } from "@/lib/routes";

type ExerciseFilter = "all" | "not_started" | "submitted" | "graded";

export function ExercisesClient() {
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

  const notStartedCount = exerciseSets.filter(
    (exercise) => exercise.latestSubmissionStatus === "not_started",
  ).length;
  const submittedCount = exerciseSets.filter((exercise) =>
    ["submitted", "auto_graded", "needs_manual_review"].includes(
      exercise.latestSubmissionStatus,
    ),
  ).length;
  const gradedCount = exerciseSets.filter(
    (exercise) => exercise.latestSubmissionStatus === "graded",
  ).length;
  const reviewCount = exerciseSets.reduce(
    (sum, exercise) => sum + exercise.pendingReviewCount,
    0,
  );

  useEffect(() => {
    listExerciseSets()
      .then((result) => setExerciseSets(result.exerciseSets))
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载练习失败");
      });
  }, []);

  return (
    <div className="workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">教学活动</p>
          <h1>练习</h1>
          <p className="muted">创建练习、跟踪提交进度并处理待批阅内容。</p>
        </div>
        <div className="page-toolbar">
          <Link className="button" href={APP_ROUTES.exercisesNew}>
            <Plus aria-hidden="true" className="button-icon" />
            创建练习
          </Link>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="metric-strip" aria-label="练习概览">
        <article className="metric">
          <span>全部练习</span>
          <strong>{exerciseSets.length}</strong>
        </article>
        <article className="metric">
          <span>未开始</span>
          <strong>{notStartedCount}</strong>
        </article>
        <article className="metric">
          <span>待处理</span>
          <strong>{submittedCount}</strong>
        </article>
        <article className="metric">
          <span>已批阅</span>
          <strong>{gradedCount}</strong>
        </article>
        <article className="metric">
          <span>待人工批阅</span>
          <strong>{reviewCount}</strong>
        </article>
      </section>

      <section className="workbench-main">
        <div className="panel-head">
          <div>
            <h2>
              <ClipboardList aria-hidden="true" className="heading-icon" />
              练习列表
            </h2>
          </div>
        </div>
        <div className="list-toolbar">
          <label className="search-field">
            <Search aria-hidden="true" />
            <input
              placeholder="搜索练习"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
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
              已批阅
            </button>
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
                <tr key={exercise.id}>
                  <td data-label="练习">
                    <div className="exercise-title-cell">
                      <Link href={exerciseDetail(exercise.id)}>
                        {exercise.title}
                      </Link>
                      <small>
                        {exercise.questionCount} 道题 · 更新于{" "}
                        {formatDateTime(exercise.updatedAt)}
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
                        <small>{exercise.pendingReviewCount} 份待批阅</small>
                      </div>
                    ) : exercise.latestSubmissionStatus === "not_started" ? (
                      "尚未提交"
                    ) : (
                      "已提交"
                    )}
                  </td>
                  <td data-label="操作">
                    <div className="table-actions compact">
                      <Link
                        className="table-action"
                        href={exerciseDetail(exercise.id)}
                      >
                        {exercise.canManage ? "查看" : "作答"}
                      </Link>
                      {exercise.canManage ? (
                        <Link
                          className="table-action"
                          href={exerciseSubmissions(exercise.id)}
                        >
                          <ClipboardCheck
                            aria-hidden="true"
                            className="button-icon"
                          />
                          批阅
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredExerciseSets.length === 0 ? (
                <tr>
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
