"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Search } from "lucide-react";
import { gradeSubmission, listSubmissions, SubmissionSummary } from "@/lib/api";
import {
  formatDateTime,
  questionTypeLabel,
  submissionStatusLabel,
} from "@/lib/labels";
import { exerciseDetail } from "@/lib/routes";

export function SubmissionsClient({
  exerciseSetId,
}: {
  exerciseSetId: string;
}) {
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"pending" | "all" | "graded">("pending");
  const [saving, setSaving] = useState(false);

  const filteredSubmissions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return submissions.filter((submission) => {
      const matchesQuery = normalizedQuery
        ? submission.user.displayName.toLowerCase().includes(normalizedQuery) ||
          submission.user.username.toLowerCase().includes(normalizedQuery)
        : true;
      const matchesFilter =
        filter === "all" ||
        (filter === "graded" && submission.status === "graded") ||
        (filter === "pending" && submission.status !== "graded");
      return matchesQuery && matchesFilter;
    });
  }, [filter, query, submissions]);

  const selectedSubmission = useMemo(
    () =>
      filteredSubmissions.find((submission) => submission.id === selectedId) ??
      filteredSubmissions[0] ??
      null,
    [filteredSubmissions, selectedId],
  );
  const pendingCount = submissions.filter(
    (submission) => submission.status !== "graded",
  ).length;

  async function load() {
    const result = await listSubmissions(exerciseSetId);
    setSubmissions(result.submissions);
    setSelectedId((current) => {
      if (
        current &&
        result.submissions.some((submission) => submission.id === current)
      ) {
        return current;
      }

      return result.submissions[0]?.id ?? null;
    });
  }

  useEffect(() => {
    load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载提交失败");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseSetId]);

  async function onGrade(
    event: FormEvent<HTMLFormElement>,
    submission: SubmissionSummary,
  ) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);

    try {
      await gradeSubmission(submission.id, {
        feedback: feedback[submission.id],
        answers: submission.answers.map((answer) => ({
          answerId: answer.id,
          score: scores[answer.id] ?? answer.score ?? 0,
          feedback: feedback[answer.id],
        })),
      });
      setMessage("批阅已保存");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批阅失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workspace">
      <section className="page-head">
        <div>
          <p className="page-eyebrow">练习管理</p>
          <h1>提交批阅</h1>
          <p className="muted">
            {submissions.length > 0
              ? `共 ${submissions.length} 份提交，选择成员后逐题评分并填写反馈。`
              : "查看成员提交，并在收到作答后完成评分与反馈。"}
          </p>
        </div>
        <div className="button-row">
          <Link
            className="button secondary"
            href={exerciseDetail(exerciseSetId)}
          >
            返回练习
          </Link>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="review-workspace">
        <aside className="review-queue">
          <div className="panel-head compact">
            <div>
              <h2>提交队列</h2>
              <span className="muted">{pendingCount} 份待批阅</span>
            </div>
          </div>
          <div className="review-queue-tools">
            <label className="search-field compact-search-field">
              <Search aria-hidden="true" />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索成员"
                value={query}
              />
            </label>
            <div className="segmented-control" aria-label="提交状态筛选">
              <button
                className={filter === "pending" ? "active" : ""}
                onClick={() => setFilter("pending")}
                type="button"
              >
                待批阅
              </button>
              <button
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
                type="button"
              >
                全部
              </button>
              <button
                className={filter === "graded" ? "active" : ""}
                onClick={() => setFilter("graded")}
                type="button"
              >
                已完成
              </button>
            </div>
          </div>
          <div className="submission-list">
            {filteredSubmissions.map((submission) => (
              <button
                className={`submission-row ${
                  selectedSubmission?.id === submission.id ? "active" : ""
                }`}
                key={submission.id}
                onClick={() => setSelectedId(submission.id)}
                type="button"
              >
                <span>
                  <strong>{submission.user.displayName}</strong>
                  <small>{formatDateTime(submission.submittedAt)}</small>
                </span>
                <em>{submissionStatusLabel(submission.status)}</em>
                <b>
                  {submission.score === null
                    ? `-/${submission.maxScore}`
                    : `${submission.score}/${submission.maxScore}`}
                </b>
              </button>
            ))}
            {filteredSubmissions.length === 0 ? (
              <div className="empty-panel">
                <strong>
                  {submissions.length === 0 ? "暂无提交" : "没有匹配结果"}
                </strong>
                <span>
                  {submissions.length === 0
                    ? "有成员提交后会出现在这里。"
                    : "调整筛选条件或搜索词。"}
                </span>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="review-detail">
          {selectedSubmission ? (
            <form
              className="review-form"
              onSubmit={(event) => void onGrade(event, selectedSubmission)}
            >
              <div className="review-detail-head">
                <div>
                  <h2>{selectedSubmission.user.displayName}</h2>
                  <p className="muted">
                    {submissionStatusLabel(selectedSubmission.status)} /{" "}
                    {selectedSubmission.score === null
                      ? `待批阅/${selectedSubmission.maxScore}`
                      : `${selectedSubmission.score}/${selectedSubmission.maxScore}`}
                  </p>
                </div>
                <button className="button" disabled={saving} type="submit">
                  <CheckCircle2 aria-hidden="true" className="button-icon" />
                  {saving ? "保存中" : "保存批阅"}
                </button>
              </div>

              <div className="answer-review-list">
                {selectedSubmission.answers.map((answer, index) => (
                  <section className="answer-review" key={answer.id}>
                    <div className="answer-review-head">
                      <div>
                        <span>题目 {index + 1}</span>
                        <h3>{getQuestionText(answer.question?.promptJson)}</h3>
                      </div>
                      <strong>
                        {answer.question
                          ? `${questionTypeLabel(answer.question.type)} / ${answer.question.score} 分`
                          : "题目"}
                      </strong>
                    </div>
                    <div className="answer-body">
                      <span>作答</span>
                      <p>{formatAnswer(answer.answerJson)}</p>
                      {answer.question?.answerJson !== undefined ? (
                        <small>
                          参考答案：{formatAnswer(answer.question.answerJson)}
                        </small>
                      ) : null}
                    </div>
                    <div className="answer-grade-grid">
                      <label className="label">
                        得分
                        <input
                          className="input"
                          max={answer.question?.score}
                          min={0}
                          onChange={(event) =>
                            setScores((current) => ({
                              ...current,
                              [answer.id]: Number(event.target.value),
                            }))
                          }
                          type="number"
                          value={scores[answer.id] ?? answer.score ?? 0}
                        />
                      </label>
                      <label className="label">
                        反馈
                        <input
                          className="input"
                          onChange={(event) =>
                            setFeedback((current) => ({
                              ...current,
                              [answer.id]: event.target.value,
                            }))
                          }
                          value={feedback[answer.id] ?? answer.feedback ?? ""}
                        />
                      </label>
                    </div>
                  </section>
                ))}
              </div>

              <label className="label">
                总体反馈
                <textarea
                  className="textarea"
                  onChange={(event) =>
                    setFeedback((current) => ({
                      ...current,
                      [selectedSubmission.id]: event.target.value,
                    }))
                  }
                  rows={3}
                  value={
                    feedback[selectedSubmission.id] ??
                    selectedSubmission.feedback ??
                    ""
                  }
                />
              </label>
            </form>
          ) : (
            <div className="empty-panel">
              <strong>请选择提交</strong>
              <span>左侧队列中选择一份提交后即可批阅。</span>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function getQuestionText(prompt: unknown): string {
  if (
    prompt &&
    typeof prompt === "object" &&
    "text" in prompt &&
    typeof prompt.text === "string"
  ) {
    return prompt.text || "未命名题目";
  }

  return "未命名题目";
}

function formatAnswer(answer: unknown): string {
  if (Array.isArray(answer)) {
    return answer.join(", ");
  }

  if (typeof answer === "boolean") {
    return answer ? "正确" : "错误";
  }

  if (typeof answer === "string") {
    return answer || "-";
  }

  return JSON.stringify(answer);
}
