"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  CirclePlus,
  Copy,
  Eye,
  FileInput,
  GripVertical,
  Library,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { QuestionType, UserSummary } from "@liveboard/shared";
import {
  getResourceNameError,
  normalizeResourceName,
} from "@liveboard/shared/resource-name";
import {
  createExerciseSet,
  CreateExerciseQuestionInput,
  ExerciseSetSummary,
  getExerciseSet,
  getMe,
  listExerciseSets,
  listVisibilityUsers,
} from "@/lib/api";
import { UserVisibilityPicker } from "@/components/UserVisibilityPicker";
import { questionTypeLabel } from "@/lib/labels";
import { APP_ROUTES } from "@/lib/routes";
import { AutoTextarea } from "@/components/AutoTextarea";

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
  const draftKey = "liveboard:exercise-builder-draft:v1";
  const draftReadyRef = useRef(false);
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
  const [required, setRequired] = useState(true);
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
  const [draggingQuestionIndex, setDraggingQuestionIndex] = useState<
    number | null
  >(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showQuestionBank, setShowQuestionBank] = useState(false);
  const [questionBank, setQuestionBank] = useState<ExerciseSetSummary[]>([]);
  const [selectedQuestionBankId, setSelectedQuestionBankId] = useState("");
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImportText, setBulkImportText] = useState("");
  const [draftRecovered, setDraftRecovered] = useState(false);

  const needsOptions = type === "single_choice" || type === "multiple_choice";
  const totalScore = useMemo(
    () => questions.reduce((sum, question) => sum + question.score, 0),
    [questions],
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(draftKey);
    if (saved) {
      try {
        const draft = JSON.parse(saved) as {
          title?: string;
          openAt?: string;
          dueAt?: string;
          allowMultipleSubmissions?: boolean;
          showAnswerAfterSubmit?: boolean;
          questions?: CreateExerciseQuestionInput[];
          visibleUserIds?: string[];
        };
        setTitle(draft.title ?? "");
        setOpenAt(draft.openAt ?? "");
        setDueAt(draft.dueAt ?? "");
        setAllowMultipleSubmissions(Boolean(draft.allowMultipleSubmissions));
        setShowAnswerAfterSubmit(Boolean(draft.showAnswerAfterSubmit));
        setQuestions(draft.questions ?? []);
        setSelectedVisibleUserIds(new Set(draft.visibleUserIds ?? []));
        setDraftRecovered(true);
      } catch {
        window.localStorage.removeItem(draftKey);
      }
    }
    draftReadyRef.current = true;

    Promise.all([getMe(), listVisibilityUsers(), listExerciseSets()])
      .then(([meResult, usersResult, exerciseResult]) => {
        setUsers(usersResult.users);
        setCreatorUserId(meResult.user.id);
        setSelectedVisibleUserIds((current) =>
          current.size ? current : new Set([meResult.user.id]),
        );
        const reusable = exerciseResult.exerciseSets.filter(
          (exercise) => exercise.canManage,
        );
        setQuestionBank(reusable);
        setSelectedQuestionBankId(reusable[0]?.id ?? "");
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载用户失败"),
      );
  }, [draftKey]);

  useEffect(() => {
    if (!draftReadyRef.current) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          title,
          openAt,
          dueAt,
          allowMultipleSubmissions,
          showAnswerAfterSubmit,
          questions,
          visibleUserIds: [...selectedVisibleUserIds],
        }),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    allowMultipleSubmissions,
    draftKey,
    dueAt,
    openAt,
    questions,
    selectedVisibleUserIds,
    showAnswerAfterSubmit,
    title,
  ]);

  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (title || questions.length || prompt) event.preventDefault();
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [prompt, questions.length, title]);

  function resetQuestionEditor() {
    setEditingIndex(null);
    setType("single_choice");
    setPrompt("");
    setOptions([...defaultOptions]);
    setAnswer(undefined);
    setScore(5);
    setRequired(true);
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
      required,
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
    setRequired(question.required ?? true);
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

  function moveQuestionTo(sourceIndex: number, targetIndex: number) {
    if (sourceIndex === targetIndex) return;
    setQuestions((current) => {
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      if (!moved) return current;
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setEditingIndex(null);
  }

  function duplicateQuestion(index: number) {
    const question = questions[index];
    if (!question) return;
    setQuestions((current) => [
      ...current.slice(0, index + 1),
      structuredClone(question),
      ...current.slice(index + 1),
    ]);
  }

  async function importFromQuestionBank() {
    if (!selectedQuestionBankId) return;
    try {
      const result = await getExerciseSet(selectedQuestionBankId);
      const imported = result.exerciseSet.questions.map((question) => ({
        type: question.type,
        promptJson: {
          text:
            question.promptJson &&
            typeof question.promptJson === "object" &&
            "text" in question.promptJson &&
            typeof question.promptJson.text === "string"
              ? question.promptJson.text
              : "未命名题目",
        },
        ...(question.optionsJson && typeof question.optionsJson === "object"
          ? { optionsJson: question.optionsJson as { options: string[] } }
          : {}),
        ...(question.answerJson !== undefined
          ? { answerJson: question.answerJson }
          : {}),
        score: question.score,
        required: question.required ?? true,
      }));
      setQuestions((current) => [...current, ...imported]);
      setShowQuestionBank(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入题目失败");
    }
  }

  function importBulkQuestions() {
    const imported = bulkImportText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map<CreateExerciseQuestionInput>((line) => {
        const [questionText = "", answerText = "", scoreText = "5"] =
          line.split("\t");
        const normalizedAnswer = answerText.trim();
        return {
          type: normalizedAnswer ? "fill_blank" : "short_answer",
          promptJson: { text: questionText.trim() },
          ...(normalizedAnswer ? { answerJson: normalizedAnswer } : {}),
          score: Math.max(1, Number.parseInt(scoreText, 10) || 5),
          required: true,
        };
      })
      .filter((question) => question.promptJson.text);

    if (!imported.length) {
      setError("没有识别到可导入的题目");
      return;
    }
    setQuestions((current) => [...current, ...imported]);
    setBulkImportText("");
    setShowBulkImport(false);
    setError(null);
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

    const nameError = getResourceNameError(title, "练习名称");
    if (nameError) {
      setError(nameError);
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
        title: normalizeResourceName(title),
        ...(openAt ? { openAt: toIsoString(openAt) } : {}),
        ...(dueAt ? { dueAt: toIsoString(dueAt) } : {}),
        allowMultipleSubmissions,
        showAnswerAfterSubmit,
        questions,
        visibleUserIds: [...selectedVisibleUserIds],
      });
      window.localStorage.removeItem(draftKey);
      router.push(APP_ROUTES.exercises);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建练习失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="workspace quiz-builder">
      <Link className="page-back-link" href={APP_ROUTES.exercises}>
        <ArrowLeft aria-hidden="true" />
        返回练习列表
      </Link>
      <section className="page-head">
        <div>
          <p className="page-eyebrow">在线练习</p>
          <h1>创建练习</h1>
        </div>
      </section>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {draftRecovered ? (
        <p className="success-text">已恢复上次未完成的练习草稿。</p>
      ) : null}

      <form className="workbench quiz-builder-form" onSubmit={onSubmit}>
        <div className="workbench-main quiz-builder-main">
          <div className="panel-head">
            <div>
              <h2>题目</h2>
            </div>
            <div className="quiz-builder-head-actions">
              <span className="quiz-builder-head-meta">
                {questions.length} 道题 · 共 {totalScore} 分
              </span>
              <button
                className="button secondary"
                disabled={!questionBank.length}
                onClick={() => setShowQuestionBank(true)}
                type="button"
              >
                <Library aria-hidden="true" className="button-icon" />
                题库复用
              </button>
              <button
                className="button secondary"
                onClick={() => setShowBulkImport(true)}
                type="button"
              >
                <FileInput aria-hidden="true" className="button-icon" />
                批量导入
              </button>
              <button
                className="button secondary"
                disabled={!questions.length}
                onClick={() => setShowPreview(true)}
                type="button"
              >
                <Eye aria-hidden="true" className="button-icon" />
                预览
              </button>
            </div>
          </div>

          <div className="quiz-question-list">
            {questions.length === 0 ? (
              <p className="quiz-question-empty">
                还没有题目，在下方编辑器中添加第一道。
              </p>
            ) : null}
            {questions.map((question, index) => (
              <article
                className={`quiz-question-row${editingIndex === index ? " editing" : ""}`}
                key={`${question.type}-${index}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggingQuestionIndex !== null) {
                    moveQuestionTo(draggingQuestionIndex, index);
                  }
                  setDraggingQuestionIndex(null);
                }}
              >
                <button
                  aria-label={`拖动第 ${index + 1} 题排序`}
                  className="quiz-question-drag"
                  draggable
                  onDragEnd={() => setDraggingQuestionIndex(null)}
                  onDragStart={() => setDraggingQuestionIndex(index)}
                  title="拖动排序"
                  type="button"
                >
                  <GripVertical aria-hidden="true" />
                </button>
                <span aria-hidden="true" className="quiz-question-number">
                  {index + 1}
                </span>
                <div className="quiz-question-main">
                  <h3>{question.promptJson.text}</h3>
                  <p>
                    {questionTypeLabel(question.type)} · {question.score} 分
                    {question.required === false ? " · 选答" : " · 必答"}
                    {question.type === "short_answer"
                      ? " · 人工批改"
                      : ` · 答案：${formatBuilderAnswer(question.answerJson)}`}
                  </p>
                </div>
                <div className="quiz-question-actions">
                  <button
                    aria-label={`复制第 ${index + 1} 题`}
                    className="inline-icon-button"
                    onClick={() => duplicateQuestion(index)}
                    title="复制题目"
                    type="button"
                  >
                    <Copy aria-hidden="true" />
                  </button>
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

          <article className="quiz-editor" id="question-editor">
            <header className="quiz-editor-head">
              <div>
                <span>
                  {editingIndex === null
                    ? "新题目"
                    : `编辑第 ${editingIndex + 1} 题`}
                </span>
                <strong>{questionTypeLabel(type)}</strong>
              </div>
              {editingIndex !== null ? (
                <button
                  className="button secondary"
                  onClick={resetQuestionEditor}
                  type="button"
                >
                  取消编辑
                </button>
              ) : null}
            </header>

            <div
              aria-label="题型"
              className="segmented-control quiz-type-picker"
              role="group"
            >
              {questionTypes.map((item) => (
                <button
                  aria-pressed={type === item.value}
                  className={type === item.value ? "active" : ""}
                  key={item.value}
                  onClick={() => changeQuestionType(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>

            <label className="label quiz-prompt-field">
              题目
              <AutoTextarea
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
                      : "勾选左侧方框设置一个或多个正确答案"}
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
              <div className="quiz-answer-block">
                <span className="quiz-answer-block-label">标准答案</span>
                <div
                  aria-label="标准答案"
                  className="segmented-control quiz-tf-picker"
                  role="group"
                >
                  <button
                    aria-pressed={answer === true}
                    className={answer === true ? "active" : ""}
                    onClick={() => setAnswer(true)}
                    type="button"
                  >
                    正确
                  </button>
                  <button
                    aria-pressed={answer === false}
                    className={answer === false ? "active" : ""}
                    onClick={() => setAnswer(false)}
                    type="button"
                  >
                    错误
                  </button>
                </div>
              </div>
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
              <div className="quiz-manual-note">
                <Check aria-hidden="true" />
                <span>
                  <strong>这道题将人工批改</strong>
                  <small>成员可输入长文本，提交后由教师给分。</small>
                </span>
              </div>
            )}

            <footer className="quiz-editor-footer">
              <div className="quiz-editor-options">
                <label className="quiz-score-field">
                  <span>分值</span>
                  <input
                    className="input"
                    min={1}
                    onChange={(event) => setScore(Number(event.target.value))}
                    type="number"
                    value={score}
                  />
                </label>
                <label className="quiz-required-field">
                  <input
                    checked={required}
                    onChange={(event) => setRequired(event.target.checked)}
                    type="checkbox"
                  />
                  必答题
                </label>
              </div>
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

          <div className="quiz-mobile-publish">
            <span>
              {questions.length} 道题 · 共 {totalScore} 分
            </span>
            <button className="button" disabled={loading} type="submit">
              {loading ? "创建中" : "创建练习"}
            </button>
          </div>
        </div>

        <aside className="workbench-side">
          <section className="action-panel quiz-settings">
            <h2>基础设置</h2>
            <label className="label">
              练习名称
              <input
                className="input"
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：第一章课后练习"
                value={title}
              />
            </label>
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
                  <small>成员提交后可查看本练习的参考答案。</small>
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

          <section className="action-panel quiz-publish">
            <h2>发布</h2>
            <dl className="quiz-publish-meta">
              <div>
                <dt>题数</dt>
                <dd>{questions.length} 道</dd>
              </div>
              <div>
                <dt>总分</dt>
                <dd>{totalScore} 分</dd>
              </div>
            </dl>
            <button
              className="button quiz-publish-button"
              disabled={loading}
              type="submit"
            >
              {loading ? "创建中" : "创建练习"}
            </button>
          </section>
        </aside>
      </form>
      {showPreview ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="quiz-preview-title"
            aria-modal="true"
            className="modal-panel quiz-preview-modal"
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <h2 id="quiz-preview-title">{title.trim() || "未命名练习"}</h2>
                <p className="muted">
                  {questions.length} 道题 · 共 {totalScore} 分
                </p>
              </div>
              <button
                className="icon-button subtle"
                onClick={() => setShowPreview(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body quiz-preview-list">
              {questions.map((question, index) => (
                <article key={`${question.type}-${index}`}>
                  <h3>
                    {index + 1}. {question.promptJson.text}
                    <small>
                      {question.required === false ? "选答" : "必答"}
                    </small>
                  </h3>
                  {getQuestionOptions(question).length ? (
                    <ol>
                      {getQuestionOptions(question).map((option) => (
                        <li key={option}>{option}</li>
                      ))}
                    </ol>
                  ) : (
                    <div className="quiz-preview-answer-line">作答区域</div>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {showQuestionBank ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="question-bank-title"
            aria-modal="true"
            className="modal-panel quiz-import-modal"
            role="dialog"
          >
            <div className="modal-head">
              <h2 id="question-bank-title">从已有练习复用题目</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowQuestionBank(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <label className="label">
                选择练习
                <select
                  className="select"
                  onChange={(event) =>
                    setSelectedQuestionBankId(event.target.value)
                  }
                  value={selectedQuestionBankId}
                >
                  {questionBank.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.title}（{exercise.questionCount} 题）
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">将复制所选练习的全部题目，可继续编辑。</p>
            </div>
            <div className="modal-foot">
              <button
                className="button"
                onClick={() => void importFromQuestionBank()}
                type="button"
              >
                导入题目
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {showBulkImport ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="bulk-question-title"
            aria-modal="true"
            className="modal-panel quiz-import-modal"
            role="dialog"
          >
            <div className="modal-head">
              <h2 id="bulk-question-title">文本批量导入</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowBulkImport(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <label className="label">
                每行一道题
                <AutoTextarea
                  className="textarea"
                  onChange={(event) => setBulkImportText(event.target.value)}
                  placeholder={
                    "题干\\t标准答案\\t分值\n没有标准答案的题目将作为简答题"
                  }
                  rows={9}
                  value={bulkImportText}
                />
              </label>
              <p className="muted">
                使用 Tab 分隔题干、标准答案和分值；标准答案留空时按简答题导入。
              </p>
            </div>
            <div className="modal-foot">
              <button
                className="button"
                onClick={importBulkQuestions}
                type="button"
              >
                导入文本
              </button>
            </div>
          </section>
        </div>
      ) : null}
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
