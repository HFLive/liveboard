"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ClipboardList,
  FileText,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { FileSummary } from "@liveboard/shared";
import {
  ContentBlock,
  createTeachingDeck,
  ExerciseSetSummary,
  getTeachingDeck,
  listBlocks,
  listExerciseSets,
  listFiles,
  updateTeachingDeck,
} from "@/lib/api";
import { APP_ROUTES, teachingEdit, teachingPresent } from "@/lib/routes";
import {
  getBlockLabel,
  getBlockText,
} from "../content/[id]/ContentBlockRenderer";

type DraftItem =
  | {
      key: string;
      type: "content_block";
      sourceBlockId: string;
      label: string;
      source: string;
    }
  | {
      key: string;
      type: "exercise";
      exerciseSetId: string;
      label: string;
      source: string;
    };

export function TeachingEditor({ deckId }: { deckId?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [exercises, setExercises] = useState<ExerciseSetSummary[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId],
  );

  useEffect(() => {
    Promise.all([
      listFiles(),
      listExerciseSets(),
      deckId ? getTeachingDeck(deckId) : Promise.resolve(null),
    ])
      .then(([fileResult, exerciseResult, deckResult]) => {
        const contentFiles = fileResult.files.filter(
          (file) => file.type !== "exercise_set" && file.type !== "asset",
        );
        setFiles(contentFiles);
        setExercises(exerciseResult.exerciseSets);
        setSelectedFileId(contentFiles[0]?.id ?? "");
        setSelectedExerciseId(exerciseResult.exerciseSets[0]?.id ?? "");
        if (deckResult) {
          if (!deckResult.deck.canEdit) {
            throw new Error("只有创建者或管理员可以编辑课件");
          }
          setTitle(deckResult.deck.title);
          setItems(
            deckResult.deck.items.reduce<DraftItem[]>((result, item) => {
              if (item.type === "content_block" && item.sourceBlockId) {
                result.push({
                  key: item.id,
                  type: "content_block" as const,
                  sourceBlockId: item.sourceBlockId,
                  label: item.block
                    ? getBlockText(item.block) || getBlockLabel(item.block.type)
                    : "文档段落",
                  source: item.sourceFileTitle ?? "文档",
                });
              }
              if (item.type === "exercise" && item.exerciseSetId) {
                result.push({
                  key: item.id,
                  type: "exercise" as const,
                  exerciseSetId: item.exerciseSetId,
                  label: item.exerciseTitle ?? "练习",
                  source: "嵌套练习",
                });
              }
              return result;
            }, []),
          );
        }
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载编辑器失败"),
      );
  }, [deckId]);

  useEffect(() => {
    if (!selectedFileId) {
      setBlocks([]);
      return;
    }
    listBlocks(selectedFileId)
      .then((result) => {
        setBlocks(result.blocks);
        setSelectedBlockIds(new Set());
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载文件段落失败"),
      );
  }, [selectedFileId]);

  function addBlocks() {
    const next = blocks
      .filter((block) => selectedBlockIds.has(block.id))
      .map((block) => ({
        key: `block-${block.id}-${Date.now()}-${Math.random()}`,
        type: "content_block" as const,
        sourceBlockId: block.id,
        label: getBlockText(block) || getBlockLabel(block.type),
        source: selectedFile?.title ?? "文档",
      }));
    setItems((current) => [...current, ...next]);
    setSelectedBlockIds(new Set());
  }

  function addExercise() {
    const exercise = exercises.find((item) => item.id === selectedExerciseId);
    if (!exercise) return;
    setItems((current) => [
      ...current,
      {
        key: `exercise-${exercise.id}-${Date.now()}`,
        type: "exercise",
        exerciseSetId: exercise.id,
        label: exercise.title,
        source: "嵌套练习",
      },
    ]);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    setItems((current) => {
      const next = [...current];
      const currentItem = next[index];
      const targetItem = next[target];
      if (!currentItem || !targetItem) return current;
      next[index] = targetItem;
      next[target] = currentItem;
      return next;
    });
  }

  async function save() {
    if (!title.trim()) {
      setError("请输入课件名称");
      return;
    }
    if (!items.length) {
      setError("请至少添加一个文档段落或练习");
      return;
    }
    setLoading(true);
    setError(null);
    const payload = {
      title: title.trim(),
      items: items.map((item) =>
        item.type === "content_block"
          ? { type: item.type, sourceBlockId: item.sourceBlockId }
          : { type: item.type, exerciseSetId: item.exerciseSetId },
      ),
    };
    try {
      const result = deckId
        ? await updateTeachingDeck(deckId, payload)
        : await createTeachingDeck(payload);
      if (!deckId) {
        router.replace(teachingEdit(result.deck.id));
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存课件失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="workspace teaching-editor-workspace">
      <Link className="back-link" href={APP_ROUTES.teaching}>
        <ArrowLeft aria-hidden="true" /> 返回课件
      </Link>
      <header className="page-head compact">
        <div>
          <p className="page-eyebrow">课件编辑</p>
          <h1>{deckId ? "编辑课件" : "创建课件"}</h1>
        </div>
      </header>
      {error ? <p className="error-text">{error}</p> : null}
      <section className="teaching-editor-grid">
        <div className="teaching-source-panel">
          <label className="form-field teaching-form-field">
            <span>文档</span>
            <div className="teaching-control teaching-select-control">
              <FileText aria-hidden="true" className="teaching-control-icon" />
              <select
                className="select"
                value={selectedFileId}
                onChange={(event) => setSelectedFileId(event.target.value)}
              >
                {files.length ? null : <option value="">暂无文档</option>}
                {files.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.title}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="teaching-select-arrow"
              />
            </div>
          </label>
          <div className="teaching-block-picker">
            {blocks.map((block) => {
              const checked = selectedBlockIds.has(block.id);
              return (
                <label className={checked ? "selected" : ""} key={block.id}>
                  <input
                    checked={checked}
                    onChange={() =>
                      setSelectedBlockIds((current) => {
                        const next = new Set(current);
                        if (next.has(block.id)) next.delete(block.id);
                        else next.add(block.id);
                        return next;
                      })
                    }
                    type="checkbox"
                  />
                  <span>
                    <small>{getBlockLabel(block.type)}</small>
                    {getBlockText(block) || "无文字内容"}
                  </span>
                </label>
              );
            })}
            {!blocks.length ? (
              <div className="compact-empty">这个文件暂无可选段落。</div>
            ) : null}
          </div>
          <button
            className="button secondary full-width"
            disabled={!selectedBlockIds.size}
            onClick={addBlocks}
            type="button"
          >
            <Plus aria-hidden="true" className="button-icon" /> 添加所选段落
          </button>
          <div className="teaching-exercise-picker">
            <label className="form-field teaching-form-field">
              <span>嵌套练习</span>
              <div className="teaching-control teaching-select-control">
                <ClipboardList
                  aria-hidden="true"
                  className="teaching-control-icon"
                />
                <select
                  className="select"
                  value={selectedExerciseId}
                  onChange={(event) =>
                    setSelectedExerciseId(event.target.value)
                  }
                >
                  {exercises.length ? null : (
                    <option value="">暂无可用练习</option>
                  )}
                  {exercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.title}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="teaching-select-arrow"
                />
              </div>
            </label>
            <button
              className="button secondary full-width"
              disabled={!selectedExerciseId}
              onClick={addExercise}
              type="button"
            >
              <ClipboardList aria-hidden="true" className="button-icon" />{" "}
              添加练习
            </button>
          </div>
        </div>

        <div className="teaching-compose-panel">
          <label className="form-field teaching-form-field teaching-title-field">
            <span>课件名称</span>
            <div className="teaching-control">
              <FileText aria-hidden="true" className="teaching-control-icon" />
              <input
                className="input"
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：第一章课堂讲解"
                value={title}
              />
            </div>
          </label>
          <div className="panel-head">
            <h2>课件内容</h2>
            <span className="muted">按顺序排列，展示时自动分页</span>
          </div>
          <div className="teaching-item-list">
            {items.map((item, index) => (
              <article className="teaching-item-row" key={item.key}>
                <span className="teaching-item-index">{index + 1}</span>
                {item.type === "content_block" ? (
                  <FileText aria-hidden="true" />
                ) : (
                  <ClipboardList aria-hidden="true" />
                )}
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.source}</small>
                </div>
                <div className="teaching-item-actions">
                  <button
                    aria-label="上移"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    type="button"
                  >
                    <ArrowUp />
                  </button>
                  <button
                    aria-label="下移"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                    type="button"
                  >
                    <ArrowDown />
                  </button>
                  <button
                    aria-label="移除"
                    onClick={() =>
                      setItems((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    <Trash2 />
                  </button>
                </div>
              </article>
            ))}
            {!items.length ? (
              <div className="empty-panel teaching-compose-empty">
                <strong>课件还是空的</strong>
                <span>从左侧选择段落或练习加入课件。</span>
              </div>
            ) : null}
          </div>
          <div className="teaching-save-bar">
            {deckId ? (
              <Link className="button secondary" href={teachingPresent(deckId)}>
                预览展示
              </Link>
            ) : null}
            <button
              className="button"
              disabled={loading}
              onClick={() => void save()}
              type="button"
            >
              <Save aria-hidden="true" className="button-icon" />
              {loading ? "保存中" : "保存课件"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
