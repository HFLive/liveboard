"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  CirclePlus,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { QuestionType, UserSummary } from "@liveboard/shared";
import {
  createExerciseSet,
  CreateExerciseQuestionInput,
  getMe,
  listVisibilityUsers,
} from "@/lib/api";
import { UserVisibilityPicker } from "@/components/UserVisibilityPicker";
import { questionTypeLabel } from "@/lib/labels";
import { APP_ROUTES } from "@/lib/routes";

const questionTypes: Array<{ value: QuestionType; label: string }> = [
  { value: "single_choice", label: questionTypeLabel("single_choice") },
  { value: "multiple_choice", label: questionTypeLabel("multiple_choice") },
  { value: "true_false", label: questionTypeLabel("true_false") },
  { value: "fill_blank", label: questionTypeLabel("fill_blank") },
  { value: "short_answer", label: questionTypeLabel("short_answer") },
];

const defaultOptions = ["选项 1", "选项 2"];
type DraftAnswer = string | string[] | boolean | undefined;

function toIsoString(value: string) {
  return new Date(value).toISOString();
}

function formatBuilderAnswer(value: unknown) {
  if (Array.isArray(value)) {
    return value.join("、");
  }

  if (typeof value === "boolean") {
    return value ? "正确" : "错误";
  }

  return typeof value === "string" && value ? value : "人工批改";
}

function getQuestionOptions(question: CreateExerciseQuestionInput) {
  return question.optionsJson?.options ?? [];
}

export function NewExerciseClient() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [openAt, setOpenAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [allowMultipleSubmissions, setAllowMultipleSubmissions] =
    useState(false);
  const [showAnswerAfterSubmit, setShowAnswerAfterSubmit] = useState(false);
  const [questions, setQuestions] = useState<CreateExerciseQuestionInput[]>([]);
  const [type, setType] = useState<QuestionType>("single_choice");
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<string[]>([...defaultOptions]);
  const [answer, setAnswer] = useState<DraftAnswer>(undefined);
  const [score, setScore] = useState(5);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [creatorUserId, setCreatorUserId] = useState("");
  const [selectedVisibleUserIds, setSelectedVisibleUserIds] = useState<
    Set<string>
  >(new Set());
  const [visibilityQuery, setVisibilityQuery] = useState("");
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [visibilityDraftUserIds, setVisibilityDraftUserIds] = useState<
    Set<string>
  >(new Set());

  const needsOptions = type === "single_choice" || type === "multiple_choice";
  const totalScore = useMemo(
    () => questions.reduce((sum, question) => sum + question.score, 0),
    [questions],
  );

  useEffect(() => {
    Promise.all([getMe(), listVisibilityUsers()])
      .then(([meResult, usersResult]) => {
        setUsers(usersResult.users);
        setCreatorUserId(meResult.user.id);
        setSelectedVisibleUserIds(new Set([meResult.user.id]));
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载用户失败"),
      );
  }, []);

  function resetQuestionEditor() {
    setEditingIndex(null);
    setType("single_choice");
    setPrompt("");
    setOptions([...defaultOptions]);
    setAnswer(undefined);
    setScore(5);
    setError(null);
  }

  function openVisibilityModal() {
    setVisibilityDraftUserIds(new Set(selectedVisibleUserIds));
    setVisibilityQuery("");
    setShowVisibilityModal(true);
  }

  function applyVisibilityDraft() {
    setSelectedVisibleUserIds(new Set(visibilityDraftUserIds));
    setShowVisibilityModal(false);
  }

  function changeQuestionType(nextType: QuestionType) {
    setType(nextType);
    setAnswer(nextType === "multiple_choice" ? [] : undefined);
    if (
      (nextType === "single_choice" || nextType === "multiple_choice") &&
      options.length < 2
    ) {
      setOptions([...defaultOptions]);
    }
  }

  function updateOption(index: number, value: string) {
    const previous = options[index] ?? "";
    setOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index ? value : option,
      ),
    );
    setAnswer((current) => {
      if (Array.isArray(current)) {
        return current.map((item) => (item === previous ? value : item));
      }
      return current === previous ? value : current;
    });
  }

  function addOption() {
    setOptions((current) => [...current, ""]);
  }

  function removeOption(index: number) {
    if (options.length <= 2) {
      setError("选择题至少保留两个选项");
      return;
    }

    const removed = options[index];
    setOptions((current) =>
      current.filter((_, optionIndex) => optionIndex !== index),
    );
    setAnswer((current) => {
      if (Array.isArray(current)) {
        return current.filter((item) => item !== removed);
      }
      return current === removed ? undefined : current;
    });
  }

  function toggleCorrectOption(option: string) {
    if (!option.trim()) {
      setError("请先填写选项内容");
      return;
    }

    if (type === "single_choice") {
      setAnswer(option);
      return;
    }

    const current = Array.isArray(answer) ? answer : [];
    setAnswer(
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option],
    );
  }

  function saveQuestion() {
    setError(null);
    const normalizedPrompt = prompt.trim();
    const normalizedOptions = options.map((option) => option.trim());

    if (!normalizedPrompt) {
      setError("请填写题干");
      return;
    }

    if (!Number.isInteger(score) || score < 1) {
      setError("分值必须是大于 0 的整数");
      return;
    }

    if (
      needsOptions &&
      (normalizedOptions.some((option) => !option) ||
        normalizedOptions.length < 2)
    ) {
      setError("请填写至少两个完整选项");
      return;
    }

    if (
      needsOptions &&
      new Set(normalizedOptions).size !== normalizedOptions.length
    ) {
      setError("选择题选项不能重复");
      return;
    }

    if (
      type === "single_choice" &&
      (typeof answer !== "string" || !normalizedOptions.includes(answer.trim()))
    ) {
      setError("请选择一个正确答案");
      return;
    }

    if (
      type === "multiple_choice" &&
      (!Array.isArray(answer) ||
        answer.length === 0 ||
        answer.some((item) => !normalizedOptions.includes(item.trim())))
    ) {
      setError("请至少选择一个正确答案");
      return;
    }

    if (type === "true_false" && typeof answer !== "boolean") {
      setError("请选择正确或错误");
      return;
    }

    if (
      type === "fill_blank" &&
      (typeof answer !== "string" || !answer.trim())
    ) {
      setError("请填写标准答案");
      return;
    }

    const question: CreateExerciseQuestionInput = {
      type,
      promptJson: { text: normalizedPrompt },
      score,
      ...(type === "short_answer"
        ? {}
        : {
            answerJson: Array.isArray(answer)
              ? answer.map((item) => item.trim())
              : typeof answer === "string"
                ? answer.trim()
                : answer,
          }),
      ...(needsOptions ? { optionsJson: { options: normalizedOptions } } : {}),
    };

    setQuestions((current) => {
      if (editingIndex === null) {
        return [...current, question];
      }
      return current.map((item, index) =>
        index === editingIndex ? question : item,
      );
    });
    resetQuestionEditor();
  }

  function editQuestion(index: number) {
    const question = questions[index];
    if (!question) {
      return;
    }

    setEditingIndex(index);
    setType(question.type);
    setPrompt(question.promptJson.text);
    setOptions(
      getQuestionOptions(question).length >= 2
        ? [...getQuestionOptions(question)]
        : [...defaultOptions],
    );
    setAnswer(question.answerJson as DraftAnswer);
    setScore(question.score);
    setError(null);
    window.requestAnimationFrame(() => {
      document
        .getElementById("question-editor")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function removeQuestion(index: number) {
    setQuestions((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    if (editingIndex === index) {
      resetQuestionEditor();
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= questions.length) {
      return;
    }

    setQuestions((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) {
        return current;
      }
      next.splice(nextIndex, 0, moved);
      return next;
    });
    setEditingIndex((current) => {
      if (current === index) return nextIndex;
      if (current === nextIndex) return index;
      return current;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (editingIndex !== null || prompt.trim()) {
      setError("请先保存正在编辑的题目");
      document
        .getElementById("question-editor")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (!title.trim()) {
      setError("请填写测验名称");
      return;
    }

    if (questions.length === 0) {
      setError("请至少添加一道题");
      return;
    }

    if (openAt && dueAt && new Date(dueAt) <= new Date(openAt)) {
      setError("截止时间必须晚于开始时间");
      return;
    }

    setLoading(true);
    try {
      await createExerciseSet({
        title: title.trim(),
        ...(openAt ? { openAt: toIsoString(openAt) } : {}),
        ...(dueAt ? { dueAt: toIsoString(dueAt) } : {}),
        allowMultipleSubmissions,
        showAnswerAfterSubmit,
        questions,
        visibleUserIds: [...selectedVisibleUserIds],
      });
      router.push(APP_ROUTES.exercises);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建练习失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="workspace quiz-builder-page">
      <Link className="page-back-link" href={APP_ROUTES.exercises}>
        <ArrowLeft aria-hidden="true" />
        返回测验列表
      </Link>
      <section className="page-head">
        <div>
          <p className="page-eyebrow">在线测验</p>
          <h1>创建测验</h1>
          <p className="muted">设置开放规则，然后逐题添加内容。</p>
        </div>
      </section>

      {error ? (
        <p className="error-text quiz-builder-error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="quiz-builder-shell" onSubmit={onSubmit}>
        <section className="quiz-settings-card">
          <div className="quiz-section-heading">
            <div>
              <span>基础设置</span>
              <h2>测验范围与开放规则</h2>
            </div>
          </div>

          <label className="label quiz-source-field">
            测验名称
            <input
              className="input"
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：第一章课后测验"
              value={title}
            />
          </label>

          <div className="quiz-settings-grid">
            <label className="label">
              开始时间（可选）
              <input
                className="input"
                onChange={(event) => setOpenAt(event.target.value)}
                type="datetime-local"
                value={openAt}
              />
              <small className="muted">不填写则创建后立即开始。</small>
            </label>
            <label className="label">
              截止时间（可选）
              <input
                className="input"
                onChange={(event) => setDueAt(event.target.value)}
                type="datetime-local"
                value={dueAt}
              />
              <small className="muted">不填写则不设截止时间。</small>
            </label>
          </div>

          <div className="quiz-rule-list">
            <label className="quiz-rule-row">
              <span>
                <strong>允许多次提交</strong>
                <small>成员可重新作答，并保留每次提交记录。</small>
              </span>
              <input
                checked={allowMultipleSubmissions}
                onChange={(event) =>
                  setAllowMultipleSubmissions(event.target.checked)
                }
                type="checkbox"
              />
            </label>
            <label className="quiz-rule-row">
              <span>
                <strong>提交后显示答案</strong>
                <small>成员提交后可查看本测验的参考答案。</small>
              </span>
              <input
                checked={showAnswerAfterSubmit}
                onChange={(event) =>
                  setShowAnswerAfterSubmit(event.target.checked)
                }
                type="checkbox"
              />
            </label>
          </div>
          {creatorUserId ? (
            <button
              className="button secondary quiz-visibility-button"
              onClick={openVisibilityModal}
              type="button"
            >
              <Users aria-hidden="true" className="button-icon" />
              可见范围（{selectedVisibleUserIds.size} 人）
            </button>
          ) : null}
        </section>

        <section className="quiz-question-section">
          <div className="quiz-section-heading quiz-question-heading">
            <div>
              <span>题目</span>
              <h2>
                {questions.length} 道题 · 共 {totalScore} 分
              </h2>
            </div>
            {editingIndex !== null ? (
              <button
                className="button secondary compact"
                onClick={resetQuestionEditor}
                type="button"
              >
                取消编辑
              </button>
            ) : null}
          </div>

          <div className="quiz-question-list">
            {questions.map((question, index) => (
              <article
                className={`quiz-question-summary ${editingIndex === index ? "editing" : ""}`}
                key={`${question.type}-${index}`}
              >
                <div className="quiz-question-summary-main">
                  <GripVertical aria-hidden="true" />
                  <span className="quiz-question-number">{index + 1}</span>
                  <div>
                    <h3>{question.promptJson.text}</h3>
                    <p>
                      {questionTypeLabel(question.type)} · {question.score} 分
                      {question.type === "short_answer"
                        ? " · 人工批改"
                        : ` · 答案：${formatBuilderAnswer(question.answerJson)}`}
                    </p>
                  </div>
                </div>
                <div className="question-order-actions">
                  <button
                    aria-label={`编辑第 ${index + 1} 题`}
                    className="inline-icon-button"
                    onClick={() => editQuestion(index)}
                    title="编辑题目"
                    type="button"
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    aria-label={`上移第 ${index + 1} 题`}
                    className="inline-icon-button"
                    disabled={index === 0}
                    onClick={() => moveQuestion(index, -1)}
                    title="上移"
                    type="button"
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    aria-label={`下移第 ${index + 1} 题`}
                    className="inline-icon-button"
                    disabled={index === questions.length - 1}
                    onClick={() => moveQuestion(index, 1)}
                    title="下移"
                    type="button"
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <button
                    aria-label={`删除第 ${index + 1} 题`}
                    className="inline-icon-button danger"
                    onClick={() => removeQuestion(index)}
                    title="删除题目"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>

          <article className="quiz-question-editor" id="question-editor">
            <div className="quiz-question-editor-head">
              <div>
                <span>
                  {editingIndex === null
                    ? "新题目"
                    : `编辑第 ${editingIndex + 1} 题`}
                </span>
                <strong>{questionTypeLabel(type)}</strong>
              </div>
              <label>
                <span>题型</span>
                <select
                  className="select"
                  value={type}
                  onChange={(event) =>
                    changeQuestionType(event.target.value as QuestionType)
                  }
                >
                  {questionTypes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="label quiz-prompt-field">
              题目
              <textarea
                className="textarea"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="输入题目内容"
                rows={3}
                value={prompt}
              />
            </label>

            {needsOptions ? (
              <div className="quiz-option-editor">
                <div className="quiz-option-editor-label">
                  <span>选项</span>
                  <small>
                    {type === "single_choice"
                      ? "点选左侧圆圈设置唯一正确答案"
                      : "点选左侧方框设置一个或多个正确答案"}
                  </small>
                </div>
                <div className="quiz-option-list">
                  {options.map((option, index) => {
                    const checked = Array.isArray(answer)
                      ? answer.includes(option)
                      : answer === option;
                    return (
                      <div className="quiz-option-row" key={index}>
                        <input
                          aria-label={`将选项 ${index + 1} 设为正确答案`}
                          checked={checked && Boolean(option.trim())}
                          name={
                            type === "single_choice"
                              ? "correct-option"
                              : undefined
                          }
                          onChange={() => toggleCorrectOption(option)}
                          type={type === "single_choice" ? "radio" : "checkbox"}
                        />
                        <input
                          aria-label={`选项 ${index + 1}`}
                          className="quiz-option-input"
                          onChange={(event) =>
                            updateOption(index, event.target.value)
                          }
                          placeholder={`选项 ${index + 1}`}
                          value={option}
                        />
                        <button
                          aria-label={`删除选项 ${index + 1}`}
                          className="inline-icon-button"
                          disabled={options.length <= 2}
                          onClick={() => removeOption(index)}
                          title="删除选项"
                          type="button"
                        >
                          <X aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  className="quiz-add-option"
                  onClick={addOption}
                  type="button"
                >
                  <Plus aria-hidden="true" />
                  添加选项
                </button>
              </div>
            ) : type === "true_false" ? (
              <fieldset className="quiz-answer-fieldset">
                <legend>标准答案</legend>
                <label>
                  <input
                    checked={answer === true}
                    name="true-false-answer"
                    onChange={() => setAnswer(true)}
                    type="radio"
                  />
                  正确
                </label>
                <label>
                  <input
                    checked={answer === false}
                    name="true-false-answer"
                    onChange={() => setAnswer(false)}
                    type="radio"
                  />
                  错误
                </label>
              </fieldset>
            ) : type === "fill_blank" ? (
              <label className="label quiz-answer-field">
                标准答案
                <input
                  className="input"
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="输入可接受的标准答案"
                  value={typeof answer === "string" ? answer : ""}
                />
              </label>
            ) : (
              <div className="quiz-manual-review-note">
                <Check aria-hidden="true" />
                <span>
                  <strong>这道题将人工批改</strong>
                  <small>成员可输入长文本，提交后由教师给分。</small>
                </span>
              </div>
            )}

            <footer className="quiz-question-editor-footer">
              <label>
                <span>分值</span>
                <input
                  className="input"
                  min={1}
                  onChange={(event) => setScore(Number(event.target.value))}
                  type="number"
                  value={score}
                />
              </label>
              <div className="button-row">
                {editingIndex !== null ? (
                  <button
                    className="button secondary"
                    onClick={resetQuestionEditor}
                    type="button"
                  >
                    取消
                  </button>
                ) : null}
                <button className="button" onClick={saveQuestion} type="button">
                  {editingIndex === null ? (
                    <CirclePlus aria-hidden="true" className="button-icon" />
                  ) : (
                    <Check aria-hidden="true" className="button-icon" />
                  )}
                  {editingIndex === null ? "添加题目" : "保存修改"}
                </button>
              </div>
            </footer>
          </article>
        </section>

        <footer className="quiz-publish-bar">
          <div>
            <strong>{questions.length} 道题</strong>
            <span>总分 {totalScore} 分</span>
          </div>
          <button className="button" disabled={loading} type="submit">
            {loading ? "创建中" : "创建测验"}
          </button>
        </footer>
      </form>
      {showVisibilityModal && creatorUserId ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="exercise-visibility-title"
            aria-modal="true"
            className="modal-panel quiz-visibility-modal"
            role="dialog"
          >
            <div className="modal-head">
              <h2 id="exercise-visibility-title">设置可见范围</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowVisibilityModal(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <UserVisibilityPicker
                creatorUserId={creatorUserId}
                onChange={setVisibilityDraftUserIds}
                onQueryChange={setVisibilityQuery}
                query={visibilityQuery}
                selectedUserIds={visibilityDraftUserIds}
                users={users}
              />
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setShowVisibilityModal(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  onClick={applyVisibilityDraft}
                  type="button"
                >
                  保存可见范围
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
