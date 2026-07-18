"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Search } from "lucide-react";
import { gradeSubmission, listSubmissions, SubmissionSummary } from "@/lib/api";
import { UserProfileLink } from "@/components/UserProfileLink";
import {
  formatDateTime,
  questionTypeLabel,
  submissionStatusLabel,
} from "@/lib/labels";
import { APP_ROUTES } from "@/lib/routes";
import { AutoTextarea } from "@/components/AutoTextarea";

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
  const [filter, setFilter] = useState<"pending" | "graded">("pending");
  const [saving, setSaving] = useState(false);

  const filteredSubmissions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return submissions.filter((submission) => {
      const matchesQuery = normalizedQuery
        ? submission.user.displayName.toLowerCase().includes(normalizedQuery) ||
          submission.user.username.toLowerCase().includes(normalizedQuery)
        : true;
      const matchesFilter =
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
      setMessage("批改已保存");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批改失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workspace review-page">
      <Link className="page-back-link" href={APP_ROUTES.exercises}>
        <ArrowLeft aria-hidden="true" />
        返回练习列表
      </Link>
      <section className="page-head">
        <div>
          <p className="page-eyebrow">练习管理</p>
          <h1>提交批改</h1>
          <p className="muted">
            {submissions.length > 0
              ? `共 ${submissions.length} 份提交，选择成员后逐题评分并填写反馈。`
              : "查看成员提交，并在收到作答后完成评分与反馈。"}
          </p>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="review-workspace">
        <aside className="review-queue">
          <div className="panel-head compact">
            <div>
              <h2>提交队列</h2>
              <span className="muted">{pendingCount} 份待批改</span>
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
                待批改
              </button>
              <button
                className={filter === "graded" ? "active" : ""}
                onClick={() => setFilter("graded")}
                type="button"
              >
                已批改
              </button>
            </div>
          </div>
          <div className="submission-list">
            {filteredSubmissions.map((submission) => (
              <div
                className={`submission-row ${
                  selectedSubmission?.id === submission.id ? "active" : ""
                }`}
                key={submission.id}
                onClick={() => setSelectedId(submission.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedId(submission.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span>
                  <strong>
                    <UserProfileLink
                      className="user-profile-link"
                      user={submission.user}
                    />
                  </strong>
                  <small>{formatDateTime(submission.submittedAt)}</small>
                </span>
                <em>{submissionStatusLabel(submission.status)}</em>
                <b>
                  {submission.score === null
                    ? `-/${submission.maxScore}`
                    : `${submission.score}/${submission.maxScore}`}
                </b>
              </div>
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
                  <h2>
                    <UserProfileLink
                      className="user-profile-link"
                      user={selectedSubmission.user}
                    />
                  </h2>
                  <p className="muted">
                    {submissionStatusLabel(selectedSubmission.status)} ·{" "}
                    {selectedSubmission.score === null
                      ? `待批改/${selectedSubmission.maxScore}`
                      : `${selectedSubmission.score}/${selectedSubmission.maxScore}`}
                  </p>
                </div>
                <button className="button" disabled={saving} type="submit">
                  <CheckCircle2 aria-hidden="true" className="button-icon" />
                  {saving ? "保存中" : "保存批改"}
                </button>
              </div>

              <div className="review-form-body">
                <div className="answer-review-list">
                  {selectedSubmission.answers.map((answer, index) => (
                    <section className="answer-review" key={answer.id}>
                      <div className="answer-review-head">
                        <div>
                          <span>题目 {index + 1}</span>
                          <h3>
                            {getQuestionText(answer.question?.promptJson)}
                          </h3>
                        </div>
                        <strong>
                          {answer.question
                            ? `${questionTypeLabel(answer.question.type)} · ${answer.question.score} 分`
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
                  <AutoTextarea
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
              </div>
            </form>
          ) : (
            <div className="empty-panel">
              <strong>请选择提交</strong>
              <span>左侧队列中选择一份提交后即可批改。</span>
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
