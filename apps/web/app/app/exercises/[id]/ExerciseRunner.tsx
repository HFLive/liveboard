"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  ExerciseQuestion,
  ExerciseSetDetail,
  getExerciseSet,
  listExerciseSets,
  listMySubmissions,
  SubmissionSummary,
  submitExerciseSet,
} from "@/lib/api";
import {
  formatDateTime,
  questionTypeLabel,
  submissionStatusLabel,
} from "@/lib/labels";
import { exerciseSubmissions } from "@/lib/routes";

type AnswerState = Record<string, string | string[] | boolean>;

function getPromptText(question: ExerciseQuestion): string {
  if (
    question.promptJson &&
    typeof question.promptJson === "object" &&
    "text" in question.promptJson &&
    typeof question.promptJson.text === "string"
  ) {
    return question.promptJson.text;
  }

  return "未命名题目";
}

function getOptions(question: ExerciseQuestion): string[] {
  if (
    question.optionsJson &&
    typeof question.optionsJson === "object" &&
    "options" in question.optionsJson &&
    Array.isArray(question.optionsJson.options)
  ) {
    return question.optionsJson.options.filter(
      (item): item is string => typeof item === "string",
    );
  }

  return [];
}

function normalizeAnswer(
  question: ExerciseQuestion,
  value: AnswerState[string] | undefined,
) {
  if (value === undefined) {
    return null;
  }

  if (question.type === "true_false") {
    return value === true || value === "true";
  }

  if (question.type === "multiple_choice") {
    return Array.isArray(value) ? value : [];
  }

  return typeof value === "string" ? value : "";
}

function getAnswerValue(
  question: ExerciseQuestion,
  answers: AnswerState,
): string | string[] | boolean | undefined {
  const value = answers[question.id];

  if (value !== undefined) {
    return value;
  }

  if (question.type === "multiple_choice") {
    return [];
  }

  if (question.type === "true_false") {
    return undefined;
  }

  return "";
}

export function ExerciseRunner({ exerciseSetId }: { exerciseSetId: string }) {
  const [exerciseSet, setExerciseSet] = useState<ExerciseSetDetail | null>(
    null,
  );
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const now = Date.now();
  const hasNotStarted =
    !!exerciseSet?.openAt && new Date(exerciseSet.openAt).getTime() > now;
  const hasEnded =
    !!exerciseSet?.dueAt && new Date(exerciseSet.dueAt).getTime() < now;
  const alreadySubmitted =
    !!exerciseSet &&
    !exerciseSet.allowMultipleSubmissions &&
    submissions.length > 0;
  const canSubmit =
    !!exerciseSet && !hasNotStarted && !hasEnded && !alreadySubmitted;
  const latestSubmission = submissions[0] ?? null;
  const answeredCount =
    exerciseSet?.questions.filter((question) =>
      isAnswered(question, answers[question.id]),
    ).length ?? 0;
  const unansweredCount = (exerciseSet?.questions.length ?? 0) - answeredCount;
  const progress = exerciseSet?.questions.length
    ? Math.round((answeredCount / exerciseSet.questions.length) * 100)
    : 0;
  const draftKey = `liveboard:exercise-draft:${exerciseSetId}`;

  useEffect(() => {
    Promise.all([
      getExerciseSet(exerciseSetId),
      listMySubmissions(exerciseSetId),
      listExerciseSets(),
    ])
      .then(([exerciseResult, submissionResult, exerciseListResult]) => {
        setExerciseSet(exerciseResult.exerciseSet);
        setSubmissions(submissionResult.submissions);
        setCanManage(
          exerciseListResult.exerciseSets.find(
            (item) => item.id === exerciseSetId,
          )?.canManage ?? false,
        );
        try {
          const storedDraft = window.localStorage.getItem(draftKey);
          if (storedDraft) {
            setAnswers(JSON.parse(storedDraft) as AnswerState);
          }
        } catch {
          window.localStorage.removeItem(draftKey);
        }
        setDraftReady(true);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载练习失败");
      });
  }, [draftKey, exerciseSetId]);

  useEffect(() => {
    if (!draftReady) {
      return;
    }

    if (Object.keys(answers).length === 0) {
      window.localStorage.removeItem(draftKey);
      return;
    }

    window.localStorage.setItem(draftKey, JSON.stringify(answers));
  }, [answers, draftKey, draftReady]);

  function setAnswer(questionId: string, value: string | string[] | boolean) {
    setConfirming(false);
    setAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
  }

  function toggleMultiple(questionId: string, option: string) {
    const current = answers[questionId];
    const values = Array.isArray(current) ? current : [];
    const next = values.includes(option)
      ? values.filter((item) => item !== option)
      : [...values, option];

    setAnswer(questionId, next);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!exerciseSet) {
      return;
    }

    if (!confirming) {
      setConfirming(true);
      setMessage(null);
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const payload = exerciseSet.questions.map((question) => ({
        questionId: question.id,
        answerJson: normalizeAnswer(
          question,
          getAnswerValue(question, answers),
        ),
      }));
      const result = await submitExerciseSet(exerciseSet.id, payload);
      const submission = result.submission;
      const [submissionResult, refreshedExercise] = await Promise.all([
        listMySubmissions(exerciseSet.id),
        getExerciseSet(exerciseSet.id),
      ]);
      setSubmissions(submissionResult.submissions);
      setExerciseSet(refreshedExercise.exerciseSet);
      setAnswers({});
      setConfirming(false);
      window.localStorage.removeItem(draftKey);
      setMessage(
        submission.score === null
          ? `已提交，状态：${submissionStatusLabel(submission.status)}`
          : `已提交，得分：${submission.score}/${submission.maxScore}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="workspace">
      <section className="page-head">
        <div>
          <p className="page-eyebrow">练习详情</p>
          <h1>{exerciseSet?.file.title ?? "练习详情"}</h1>
          <p className="muted">
            {exerciseSet
              ? `共 ${exerciseSet.questions.length} 道题 · ${exerciseSet.dueAt ? `截止 ${formatDateTime(exerciseSet.dueAt)}` : "无截止时间"}`
              : "正在加载练习内容与提交状态。"}
          </p>
        </div>
        {canManage ? (
          <div className="button-row">
            <Link
              className="button secondary"
              href={exerciseSubmissions(exerciseSetId)}
            >
              批阅提交
            </Link>
          </div>
        ) : null}
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <form className="workbench exercise-runner-form" onSubmit={onSubmit}>
        <div className="workbench-main">
          <div className="panel-head">
            <div>
              <h2>题目</h2>
            </div>
          </div>
          <div className="mobile-submit-bar">
            <span>
              已答 {answeredCount}/{exerciseSet?.questions.length ?? 0}
            </span>
            <button
              className="button"
              disabled={loading || !canSubmit}
              type="submit"
            >
              {loading ? "提交中" : confirming ? "确认提交" : "检查提交"}
            </button>
          </div>
          <div className="editor">
            {exerciseSet?.questions.map((question, index) => (
              <article
                className={`exercise-question-card form ${
                  isAnswered(question, answers[question.id]) ? "answered" : ""
                }`}
                id={`question-${question.id}`}
                key={question.id}
              >
                <h2>
                  {index + 1}. {getPromptText(question)}
                </h2>
                <p className="muted">
                  {questionTypeLabel(question.type)} / {question.score} 分
                </p>
                <QuestionInput
                  answer={answers[question.id]}
                  onChange={(value) => setAnswer(question.id, value)}
                  onToggle={(option) => toggleMultiple(question.id, option)}
                  question={question}
                  disabled={!canSubmit}
                />
              </article>
            ))}
          </div>
        </div>

        <aside className="workbench-side">
          <section className="action-panel">
            <h2>提交</h2>
            <div className="status-list">
              <span>{exerciseSet?.questions.length ?? 0} 道题</span>
              <span>开始：{formatDateTime(exerciseSet?.openAt)}</span>
              <span>截止：{formatDateTime(exerciseSet?.dueAt)}</span>
              <span>
                提交：
                {exerciseSet?.allowMultipleSubmissions ? "允许多次" : "仅一次"}
              </span>
            </div>
            <div
              className="exercise-progress"
              aria-label={`已完成 ${progress}%`}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className="exercise-progress-label">
              已答 {answeredCount} 题，剩余 {unansweredCount} 题
            </p>
            <nav className="question-jump-list" aria-label="题目导航">
              {exerciseSet?.questions.map((question, index) => (
                <a
                  className={
                    isAnswered(question, answers[question.id]) ? "answered" : ""
                  }
                  href={`#question-${question.id}`}
                  key={question.id}
                >
                  {index + 1}
                </a>
              ))}
            </nav>
            {hasNotStarted ? (
              <p className="notice-box">练习还未开始。</p>
            ) : null}
            {hasEnded ? <p className="notice-box">练习已截止。</p> : null}
            {alreadySubmitted ? (
              <p className="notice-box">这个练习仅允许提交一次。</p>
            ) : null}
            {confirming ? (
              <div className="submit-confirmation" role="status">
                <strong>提交后将记录本次作答</strong>
                <span>
                  {unansweredCount > 0
                    ? `仍有 ${unansweredCount} 道题未作答，可以留空提交。`
                    : "所有题目均已作答，请确认提交。"}
                </span>
                <button
                  className="button secondary"
                  onClick={() => setConfirming(false)}
                  type="button"
                >
                  返回检查
                </button>
              </div>
            ) : null}
            <button
              className="button"
              disabled={loading || !canSubmit}
              type="submit"
            >
              {loading ? "提交中" : confirming ? "确认提交" : "检查提交"}
            </button>
          </section>

          <section className="action-panel quiet">
            <h2>我的提交</h2>
            {latestSubmission ? (
              <div className="submission-result">
                <strong>
                  {latestSubmission.score === null
                    ? submissionStatusLabel(latestSubmission.status)
                    : `${latestSubmission.score}/${latestSubmission.maxScore}`}
                </strong>
                <span>{submissionStatusLabel(latestSubmission.status)}</span>
                {latestSubmission.feedback ? (
                  <p>{latestSubmission.feedback}</p>
                ) : null}
              </div>
            ) : (
              <p className="muted">还没有提交记录。</p>
            )}
            <div className="submission-history">
              {submissions.map((submission, index) => (
                <details key={submission.id} open={index === 0}>
                  <summary>
                    <span>第 {submissions.length - index} 次提交</span>
                    <b>
                      {submission.score === null
                        ? submissionStatusLabel(submission.status)
                        : `${submission.score}/${submission.maxScore}`}
                    </b>
                  </summary>
                  <div className="answer-feedback-list">
                    {submission.answers.map((answer, answerIndex) => (
                      <div className="answer-feedback" key={answer.id}>
                        <span>题目 {answerIndex + 1}</span>
                        <strong>
                          {getQuestionText(answer.question?.promptJson)}
                        </strong>
                        <p>作答：{formatAnswer(answer.answerJson)}</p>
                        {answer.question?.answerJson !== undefined ? (
                          <p className="correct-answer">
                            参考答案：{formatAnswer(answer.question.answerJson)}
                          </p>
                        ) : null}
                        <small>
                          得分：
                          {answer.score === null
                            ? "待批阅"
                            : `${answer.score}/${answer.question?.score ?? "-"}`}
                        </small>
                        {answer.feedback ? <em>{answer.feedback}</em> : null}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        </aside>
      </form>
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

function isAnswered(
  question: ExerciseQuestion,
  answer: string | string[] | boolean | undefined,
) {
  if (answer === undefined) {
    return false;
  }

  if (question.type === "multiple_choice") {
    return Array.isArray(answer) && answer.length > 0;
  }

  if (typeof answer === "string") {
    return Boolean(answer.trim());
  }

  return typeof answer === "boolean";
}

function QuestionInput({
  answer,
  onChange,
  onToggle,
  question,
  disabled,
}: {
  answer: string | string[] | boolean | undefined;
  onChange: (value: string | string[] | boolean) => void;
  onToggle: (option: string) => void;
  question: ExerciseQuestion;
  disabled: boolean;
}) {
  const options = getOptions(question);

  if (question.type === "single_choice") {
    return (
      <div className="choice-list">
        {options.map((option) => (
          <label className="choice-row" key={option}>
            <input
              checked={answer === option}
              disabled={disabled}
              name={question.id}
              onChange={() => onChange(option)}
              type="radio"
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (question.type === "multiple_choice") {
    const values = Array.isArray(answer) ? answer : [];

    return (
      <div className="choice-list">
        {options.map((option) => (
          <label className="choice-row" key={option}>
            <input
              checked={values.includes(option)}
              disabled={disabled}
              onChange={() => onToggle(option)}
              type="checkbox"
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (question.type === "true_false") {
    return (
      <div className="choice-list">
        <label className="choice-row">
          <input
            checked={answer === true}
            disabled={disabled}
            name={question.id}
            onChange={() => onChange(true)}
            type="radio"
          />
          正确
        </label>
        <label className="choice-row">
          <input
            checked={answer === false}
            disabled={disabled}
            name={question.id}
            onChange={() => onChange(false)}
            type="radio"
          />
          错误
        </label>
      </div>
    );
  }

  if (question.type === "short_answer") {
    return (
      <textarea
        className="textarea"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={6}
        value={typeof answer === "string" ? answer : ""}
      />
    );
  }

  return (
    <input
      className="input"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      value={typeof answer === "string" ? answer : ""}
    />
  );
}
