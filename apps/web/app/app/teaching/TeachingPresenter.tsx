"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Grid2X2,
  Keyboard,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import {
  ContentBlock,
  ExerciseQuestion,
  ExerciseSetDetail,
  getExerciseSet,
  getTeachingDeck,
  submitExerciseSet,
  TeachingDeckDetail,
  TeachingDeckItem,
} from "@/lib/api";
import { APP_ROUTES, teachingEdit } from "@/lib/routes";
import { RenderBlockContent } from "../content/[id]/ContentBlockRenderer";
import { buildTeachingSlides } from "./teachingSlides";
import { AutoTextarea } from "@/components/AutoTextarea";

type AnswerValue = string | string[] | boolean;

export function TeachingPresenter({ deckId }: { deckId: string }) {
  const stageRef = useRef<HTMLElement | null>(null);
  const slideRef = useRef<HTMLElement | null>(null);
  const [deck, setDeck] = useState<TeachingDeckDetail | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showNavigator, setShowNavigator] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileManuscript, setMobileManuscript] = useState(false);
  const slides = useMemo(
    () => buildTeachingSlides(deck?.items ?? []),
    [deck?.items],
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const updateMode = () => setMobileManuscript(media.matches);
    updateMode();
    media.addEventListener("change", updateMode);
    return () => media.removeEventListener("change", updateMode);
  }, []);

  useEffect(() => {
    getTeachingDeck(deckId)
      .then((result) => setDeck(result.deck))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载课件失败"),
      );
  }, [deckId]);

  useEffect(() => {
    if (mobileManuscript) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileManuscript]);

  useEffect(() => {
    if (mobileManuscript) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a")) return;
      if (
        event.key === "ArrowRight" ||
        event.key === "PageDown" ||
        event.key === " "
      ) {
        event.preventDefault();
        setActiveIndex((current) =>
          Math.min(current + 1, Math.max(slides.length - 1, 0)),
        );
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
      }
      if (event.key === "Home") setActiveIndex(0);
      if (event.key === "End") setActiveIndex(Math.max(slides.length - 1, 0));
      if (event.key === "Escape" && focusMode && !document.fullscreenElement)
        setFocusMode(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode, mobileManuscript, slides.length]);

  useEffect(() => {
    function onFullscreenChange() {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active) setFocusMode(false);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(slides.length - 1, 0)),
    );
  }, [slides.length]);

  async function toggleFullscreen() {
    if (document.fullscreenElement || focusMode) {
      if (document.fullscreenElement) await document.exitFullscreen();
      else setFocusMode(false);
      return;
    }
    setFocusMode(true);
    try {
      await stageRef.current?.requestFullscreen();
    } catch {
      /* 保留页面内专注模式。 */
    }
  }

  const activeSlide =
    slides[Math.min(activeIndex, Math.max(slides.length - 1, 0))];
  const full = isFullscreen || focusMode;

  useLayoutEffect(() => {
    if (mobileManuscript) return;
    const slide = slideRef.current;
    if (!slide || !activeSlide) return;
    const fitGroupId = activeSlide.fitGroupId;
    let frame = 0;

    function fitSlide() {
      if (!slide) return;
      const groupedScale = fitGroupId
        ? Math.max(
            0.48,
            Math.min(0.62, window.innerWidth / 700, window.innerHeight / 700),
          )
        : null;
      let scale = groupedScale ?? 1;
      slide.style.setProperty("--slide-fit", String(scale));
      if (groupedScale !== null) {
        slide.dataset.fitScale = scale.toFixed(3);
        return;
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const fits =
          slide.scrollHeight <= slide.clientHeight + 1 &&
          slide.scrollWidth <= slide.clientWidth + 1;
        if (fits || scale <= 0.62) break;
        scale = Math.max(0.62, scale - 0.055);
        slide.style.setProperty("--slide-fit", String(scale));
      }
      slide.dataset.fitScale = scale.toFixed(3);
    }

    function scheduleFit() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitSlide);
    }

    scheduleFit();
    window.addEventListener("resize", scheduleFit);
    const images = Array.from(slide.querySelectorAll("img"));
    images.forEach((image) => image.addEventListener("load", scheduleFit));
    void document.fonts?.ready.then(scheduleFit);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleFit);
      images.forEach((image) => image.removeEventListener("load", scheduleFit));
    };
  }, [activeSlide, full, mobileManuscript]);

  if (mobileManuscript) {
    return <TeachingManuscript deck={deck} error={error} />;
  }

  return (
    <div className={`teaching-presenter ${focusMode ? "focus-mode" : ""}`}>
      <header className="teaching-presenter-topbar">
        <div>
          <h1>{deck?.title ?? "课件"}</h1>
          <span className="teaching-page-count">
            {slides.length
              ? `${activeIndex + 1} / ${slides.length}`
              : "正在加载"}
          </span>
        </div>
        <div className="button-row">
          <Link
            aria-label="返回课件"
            className="button secondary"
            href={APP_ROUTES.teaching}
            title="返回课件"
          >
            <ArrowLeft aria-hidden="true" className="button-icon" />
            <span>返回课件</span>
          </Link>
          {deck?.canEdit ? (
            <Link
              aria-label="编辑课件"
              className="button secondary"
              href={teachingEdit(deckId)}
              title="编辑课件"
            >
              <Edit3 aria-hidden="true" className="button-icon" />
              <span>编辑</span>
            </Link>
          ) : null}
          <button
            aria-label="打开页面导航"
            className="button secondary"
            onClick={() => setShowNavigator((current) => !current)}
            title="页面导航"
            type="button"
          >
            <Grid2X2 aria-hidden="true" className="button-icon" />
            <span>页面</span>
          </button>
          <button
            aria-label="查看键盘帮助"
            className="button secondary"
            onClick={() => setShowHelp(true)}
            title="键盘帮助"
            type="button"
          >
            <Keyboard aria-hidden="true" className="button-icon" />
            <span>快捷键</span>
          </button>
          <button
            aria-label={full ? "退出全屏" : "全屏展示"}
            className="button secondary"
            onClick={() => void toggleFullscreen()}
            title={full ? "退出全屏" : "全屏展示"}
            type="button"
          >
            {full ? (
              <Minimize2 aria-hidden="true" className="button-icon" />
            ) : (
              <Maximize2 aria-hidden="true" className="button-icon" />
            )}
            <span>{full ? "退出全屏" : "全屏展示"}</span>
          </button>
        </div>
      </header>
      {error ? <p className="error-text">{error}</p> : null}
      <section className="teaching-presenter-stage" ref={stageRef}>
        {showNavigator ? (
          <aside className="teaching-slide-navigator" aria-label="页面导航">
            <header>
              <strong>页面</strong>
              <button
                aria-label="关闭页面导航"
                onClick={() => setShowNavigator(false)}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div>
              {slides.map((slide, index) => (
                <button
                  className={index === activeIndex ? "active" : ""}
                  key={slide.id}
                  onClick={() => {
                    setActiveIndex(index);
                    setShowNavigator(false);
                  }}
                  type="button"
                >
                  <span>{index + 1}</span>
                  <strong>{slide.sourceLabel || `第 ${index + 1} 页`}</strong>
                </button>
              ))}
            </div>
          </aside>
        ) : null}
        <div className="teaching-slide-source">{activeSlide?.sourceLabel}</div>
        <div className="teaching-slide-viewport">
          <article
            className={`teaching-slide ${activeSlide ? `${activeSlide.kind}-slide` : ""}`}
            ref={slideRef}
          >
            <div className="teaching-slide-content">
              {activeSlide ? (
                activeSlide.items.map((item) => (
                  <div className="teaching-slide-block" key={item.id}>
                    <SlideContent item={item} />
                  </div>
                ))
              ) : (
                <p className="muted">课件暂无内容。</p>
              )}
            </div>
          </article>
        </div>
        <div className="teaching-presenter-controls">
          <button
            aria-label="上一页"
            disabled={activeIndex === 0}
            onClick={() =>
              setActiveIndex((current) => Math.max(current - 1, 0))
            }
            type="button"
          >
            <ChevronLeft />
          </button>
          <div className="teaching-progress">
            <span
              style={{
                width: `${slides.length ? ((activeIndex + 1) / slides.length) * 100 : 0}%`,
              }}
            />
          </div>
          <button
            aria-label="下一页"
            disabled={!slides.length || activeIndex >= slides.length - 1}
            onClick={() =>
              setActiveIndex((current) =>
                Math.min(current + 1, slides.length - 1),
              )
            }
            type="button"
          >
            <ChevronRight />
          </button>
        </div>
        <div className="teaching-presenter-info" aria-live="polite">
          <span>当前：{activeSlide?.sourceLabel ?? "无内容"}</span>
          <span>
            下一页：{slides[activeIndex + 1]?.sourceLabel ?? "已是最后一页"}
          </span>
        </div>
      </section>
      {showHelp ? (
        <div className="teaching-help-backdrop" role="presentation">
          <section
            aria-labelledby="teaching-help-title"
            aria-modal="true"
            className="teaching-help-dialog"
            role="dialog"
          >
            <header>
              <h2 id="teaching-help-title">展示快捷键</h2>
              <button
                aria-label="关闭快捷键帮助"
                onClick={() => setShowHelp(false)}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <dl>
              <div>
                <dt>下一页</dt>
                <dd>→ / 空格 / PageDown</dd>
              </div>
              <div>
                <dt>上一页</dt>
                <dd>← / PageUp</dd>
              </div>
              <div>
                <dt>第一页 / 最后一页</dt>
                <dd>Home / End</dd>
              </div>
              <div>
                <dt>退出专注模式</dt>
                <dd>Esc</dd>
              </div>
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function TeachingManuscript({
  deck,
  error,
}: {
  deck: TeachingDeckDetail | null;
  error: string | null;
}) {
  return (
    <div className="teaching-manuscript">
      <header className="teaching-manuscript-topbar">
        <Link aria-label="返回课件" href={APP_ROUTES.teaching} title="返回课件">
          <ArrowLeft aria-hidden="true" />
        </Link>
        <h1>{deck?.title ?? "课件"}</h1>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      <article className="teaching-manuscript-body">
        {!deck && !error ? <p className="muted">正在加载课件…</p> : null}
        {deck?.items.length === 0 ? (
          <p className="muted">课件暂无内容。</p>
        ) : null}
        {deck?.items.map((item, index) => {
          const source = manuscriptSource(item);
          const previousSource =
            index > 0 ? manuscriptSource(deck.items[index - 1]!) : null;
          return (
            <section
              className={`teaching-manuscript-block ${source !== previousSource ? "source-start" : ""}`}
              key={item.id}
            >
              {source !== previousSource ? (
                <div className="teaching-manuscript-source">{source}</div>
              ) : null}
              <SlideContent item={item} />
            </section>
          );
        })}
      </article>
    </div>
  );
}

function manuscriptSource(item: TeachingDeckItem) {
  return item.type === "exercise" ? "课堂练习" : item.sourceFileTitle || "文档";
}

function SlideContent({ item }: { item: TeachingDeckItem }) {
  if (item.type === "exercise" && item.exerciseSetId) {
    return <EmbeddedExercise exerciseSetId={item.exerciseSetId} />;
  }
  return item.block ? (
    <div className={`teaching-image-${getTeachingImageFit(item.block)}`}>
      <RenderBlockContent block={item.block} />
    </div>
  ) : (
    <p>原文档段落不可用。</p>
  );
}

function getTeachingImageFit(block: ContentBlock) {
  if (!block.dataJson || typeof block.dataJson !== "object") return "fit";
  const value = (block.dataJson as { teachingImageFit?: unknown })
    .teachingImageFit;
  return value === "fill" || value === "original" ? value : "fit";
}

function EmbeddedExercise({ exerciseSetId }: { exerciseSetId: string }) {
  const [exercise, setExercise] = useState<ExerciseSetDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getExerciseSet(exerciseSetId)
      .then((result) => setExercise(result.exerciseSet))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载练习失败"),
      );
  }, [exerciseSetId]);

  async function submit() {
    if (!exercise) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await submitExerciseSet(
        exercise.id,
        exercise.questions.map((question) => ({
          questionId: question.id,
          answerJson: normalizeAnswer(question, answers[question.id]),
        })),
      );
      setMessage(
        result.submission.score === null
          ? "练习已提交，等待批改。"
          : `练习已提交，得分 ${result.submission.score}/${result.submission.maxScore}。`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交练习失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !exercise) return <p className="error-text">{error}</p>;
  return (
    <div className="embedded-exercise">
      <div className="embedded-exercise-head">
        <div>
          <span className="embedded-exercise-kicker">课堂练习</span>
          <h2>{exercise?.title ?? "加载练习…"}</h2>
        </div>
        <span className="embedded-exercise-count">
          {exercise?.questions.length ?? 0} 道题
        </span>
      </div>
      <div className="embedded-question-list">
        {exercise?.questions.map((question, index) => (
          <div className="embedded-question" key={question.id}>
            <div className="embedded-question-head">
              <span className="embedded-question-index">{index + 1}</span>
              <strong>{promptText(question)}</strong>
            </div>
            <QuestionField
              question={question}
              value={answers[question.id]}
              onChange={(value) =>
                setAnswers((current) => ({ ...current, [question.id]: value }))
              }
            />
          </div>
        ))}
      </div>
      <div className="embedded-exercise-footer">
        <div aria-live="polite">
          {error ? <p className="error-text">{error}</p> : null}
          {message ? <p className="success-text">{message}</p> : null}
        </div>
        <button
          className="button"
          disabled={!exercise || submitting || Boolean(message)}
          onClick={() => void submit()}
          type="button"
        >
          {submitting ? "提交中" : message ? "已提交" : "提交练习"}
        </button>
      </div>
    </div>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: ExerciseQuestion;
  value?: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const options = optionValues(question);
  if (question.type === "single_choice" || question.type === "true_false") {
    const values = question.type === "true_false" ? ["true", "false"] : options;
    return (
      <div className="embedded-options">
        {values.map((option) => (
          <label key={option}>
            <input
              checked={String(value ?? "") === option}
              name={question.id}
              onChange={() =>
                onChange(
                  question.type === "true_false" ? option === "true" : option,
                )
              }
              type="radio"
            />
            <span>
              {question.type === "true_false"
                ? option === "true"
                  ? "正确"
                  : "错误"
                : option}
            </span>
          </label>
        ))}
      </div>
    );
  }
  if (question.type === "multiple_choice") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="embedded-options">
        {options.map((option) => (
          <label key={option}>
            <input
              checked={selected.includes(option)}
              onChange={() =>
                onChange(
                  selected.includes(option)
                    ? selected.filter((item) => item !== option)
                    : [...selected, option],
                )
              }
              type="checkbox"
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }
  return question.type === "short_answer" ? (
    <AutoTextarea
      onChange={(event) => onChange(event.target.value)}
      placeholder="输入回答"
      value={typeof value === "string" ? value : ""}
    />
  ) : (
    <input
      onChange={(event) => onChange(event.target.value)}
      placeholder="输入答案"
      value={typeof value === "string" ? value : ""}
    />
  );
}

function promptText(question: ExerciseQuestion) {
  return question.promptJson &&
    typeof question.promptJson === "object" &&
    "text" in question.promptJson &&
    typeof question.promptJson.text === "string"
    ? question.promptJson.text
    : "未命名题目";
}

function optionValues(question: ExerciseQuestion): string[] {
  return question.optionsJson &&
    typeof question.optionsJson === "object" &&
    "options" in question.optionsJson &&
    Array.isArray(question.optionsJson.options)
    ? question.optionsJson.options.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

function normalizeAnswer(question: ExerciseQuestion, value?: AnswerValue) {
  if (question.type === "multiple_choice")
    return Array.isArray(value) ? value : [];
  if (question.type === "true_false")
    return typeof value === "boolean" ? value : null;
  return typeof value === "string" ? value : "";
}
