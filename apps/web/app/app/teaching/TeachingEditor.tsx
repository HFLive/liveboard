"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { FileSummary } from "@liveboard/shared";
import {
  getResourceNameError,
  normalizeResourceName,
} from "@liveboard/shared/resource-name";
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
import { classroomDetail, teachingEdit } from "@/lib/routes";
import {
  getBlockLabel,
  getBlockText,
} from "../content/[id]/ContentBlockRenderer";

const EXERCISE_SOURCE = "嵌套练习";

type DraftItem =
  | {
      key: string;
      type: "content_block";
      sourceBlockId: string;
      label: string;
      source: string;
      blockType: ContentBlock["type"];
      imageFit: "fit" | "fill" | "original";
    }
  | {
      key: string;
      type: "exercise";
      exerciseSetId: string;
      label: string;
      source: string;
    };

type SaveState = "clean" | "dirty" | "saving";

export function TeachingEditor({
  deckId,
  classroomId,
}: {
  deckId?: string;
  classroomId?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [exercises, setExercises] = useState<ExerciseSetSummary[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedExerciseIds, setSelectedExerciseIds] = useState<Set<string>>(
    new Set(),
  );
  const [items, setItems] = useState<DraftItem[]>([]);
  const [activeClassroomId, setActiveClassroomId] = useState(classroomId ?? "");
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [sourceTab, setSourceTab] = useState<"document" | "exercise">(
    "document",
  );
  const [draggingItemKey, setDraggingItemKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId],
  );

  const selectedCount =
    sourceTab === "document" ? selectedBlockIds.size : selectedExerciseIds.size;

  useEffect(() => {
    async function load() {
      const deckResult = deckId ? await getTeachingDeck(deckId) : null;
      const resolvedClassroomId =
        classroomId ?? deckResult?.deck.classroomId ?? "";
      if (!resolvedClassroomId) {
        throw new Error("请从课堂内创建课件");
      }
      setActiveClassroomId(resolvedClassroomId);
      const [fileResult, exerciseResult] = await Promise.all([
        listFiles(),
        listExerciseSets(resolvedClassroomId),
      ]);
      const contentFiles = fileResult.files.filter(
        (file) => file.type !== "exercise_set" && file.type !== "asset",
      );
      setFiles(contentFiles);
      setExercises(exerciseResult.exerciseSets);
      setSelectedFileId(contentFiles[0]?.id ?? "");
      if (!deckResult) return;
      if (!deckResult.deck.canEdit) {
        throw new Error("只有课堂教师可以编辑课件");
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
              blockType: item.block?.type ?? "paragraph",
              imageFit: getTeachingImageFit(item.block),
            });
          }
          if (item.type === "exercise" && item.exerciseSetId) {
            result.push({
              key: item.id,
              type: "exercise" as const,
              exerciseSetId: item.exerciseSetId,
              label: item.exerciseTitle ?? "练习",
              source: EXERCISE_SOURCE,
            });
          }
          return result;
        }, []),
      );
    }
    load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "加载编辑器失败"),
    );
  }, [classroomId, deckId]);

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

  /** 所有用户改动都经过这里，让顶栏的保存状态始终反映真实进度。 */
  function editItems(next: (current: DraftItem[]) => DraftItem[]) {
    setItems(next);
    setSaveState("dirty");
  }

  function addSelected() {
    if (sourceTab === "document") {
      const next = blocks
        .filter((block) => selectedBlockIds.has(block.id))
        .map((block) => ({
          key: `block-${block.id}-${Date.now()}-${Math.random()}`,
          type: "content_block" as const,
          sourceBlockId: block.id,
          label: getBlockText(block) || getBlockLabel(block.type),
          source: selectedFile?.title ?? "文档",
          blockType: block.type,
          imageFit: "fit" as const,
        }));
      if (!next.length) return;
      editItems((current) => [...current, ...next]);
      setSelectedBlockIds(new Set());
      return;
    }
    const next = exercises
      .filter((exercise) => selectedExerciseIds.has(exercise.id))
      .map((exercise) => ({
        key: `exercise-${exercise.id}-${Date.now()}-${Math.random()}`,
        type: "exercise" as const,
        exerciseSetId: exercise.id,
        label: exercise.title,
        source: EXERCISE_SOURCE,
      }));
    if (!next.length) return;
    editItems((current) => [...current, ...next]);
    setSelectedExerciseIds(new Set());
  }

  function toggleId(
    setter: typeof setSelectedBlockIds,
    id: string,
    checked: boolean,
  ) {
    setter((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    editItems((current) => {
      const next = [...current];
      const currentItem = next[index];
      const targetItem = next[target];
      if (!currentItem || !targetItem) return current;
      next[index] = targetItem;
      next[target] = currentItem;
      return next;
    });
  }

  function moveTo(itemKey: string, targetKey: string) {
    if (itemKey === targetKey) return;
    editItems((current) => {
      const sourceIndex = current.findIndex((item) => item.key === itemKey);
      const targetIndex = current.findIndex((item) => item.key === targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      if (!moved) return current;
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  async function save() {
    const nameError = getResourceNameError(title, "课件名称");
    if (nameError) {
      setError(nameError);
      return;
    }
    if (!items.length) {
      setError("请至少添加一个文档段落或练习");
      return;
    }
    setSaveState("saving");
    setError(null);
    const payload = {
      classroomId: activeClassroomId,
      title: normalizeResourceName(title),
      items: items.map((item) =>
        item.type === "content_block"
          ? {
              type: item.type,
              sourceBlockId: item.sourceBlockId,
              ...(item.blockType === "image"
                ? { imageFit: item.imageFit }
                : {}),
            }
          : { type: item.type, exerciseSetId: item.exerciseSetId },
      ),
    };
    try {
      const result = deckId
        ? await updateTeachingDeck(deckId, {
            title: payload.title,
            items: payload.items,
          })
        : await createTeachingDeck(payload);
      setSaveState("clean");
      setSavedAt(new Date());
      if (!deckId) {
        router.replace(teachingEdit(result.deck.id));
      }
      router.refresh();
    } catch (caught) {
      setSaveState("dirty");
      setError(caught instanceof Error ? caught.message : "保存课件失败");
    }
  }

  return (
    <div className="workspace teaching-editor-workspace">
      <Link
        className="page-back-link"
        href={classroomDetail(activeClassroomId, "teaching")}
      >
        <ArrowLeft aria-hidden="true" />
        <span>返回课件</span>
      </Link>

      <header className="page-head compact editor-title-bar">
        <div>
          <input
            aria-label="课件名称"
            className="title-input"
            maxLength={120}
            onChange={(event) => {
              setTitle(event.target.value);
              setSaveState("dirty");
            }}
            placeholder="未命名课件"
            value={title}
          />
          <div className="editor-meta-strip" aria-label="课件信息">
            <span>
              <strong>内容</strong>
              {items.length} 项
            </span>
            <span>
              <strong>保存</strong>
              {saveState === "saving"
                ? "保存中…"
                : saveState === "dirty"
                  ? "有未保存修改"
                  : savedAt
                    ? `已保存 ${savedAt.toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : deckId
                      ? "已保存"
                      : "尚未保存"}
            </span>
          </div>
        </div>
        <div className="button-row">
          <button
            className="button"
            disabled={saveState === "saving"}
            onClick={() => void save()}
            type="button"
          >
            <Save aria-hidden="true" className="button-icon" />
            {saveState === "saving" ? "保存中" : "保存课件"}
          </button>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="editor-split teaching-editor-split">
        <section
          className="editor-pane teaching-outline-pane"
          aria-label="课件大纲"
        >
          {items.length === 0 ? (
            <p className="teaching-item-empty">
              课件还是空的。在右侧勾选文档段落或练习添加到这里，之后可拖动调整顺序。
            </p>
          ) : (
            <ol className="teaching-item-list">
              {items.map((item, index) => {
                const previous = items[index - 1];
                const startsGroup =
                  !previous || previous.source !== item.source;
                return (
                  <Fragment key={item.key}>
                    {startsGroup ? (
                      <li className="teaching-item-group" aria-hidden="true">
                        {item.source}
                      </li>
                    ) : null}
                    <li
                      className={`teaching-item-row ${draggingItemKey === item.key ? "dragging" : ""}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (draggingItemKey) moveTo(draggingItemKey, item.key);
                        setDraggingItemKey(null);
                      }}
                    >
                      <button
                        aria-label={`拖动第 ${index + 1} 项排序`}
                        className="teaching-item-drag"
                        draggable
                        onDragEnd={() => setDraggingItemKey(null)}
                        onDragStart={() => setDraggingItemKey(item.key)}
                        title="拖动排序"
                        type="button"
                      >
                        <GripVertical aria-hidden="true" />
                      </button>
                      <span className="teaching-item-index">{index + 1}</span>
                      <div className="teaching-item-main">
                        <span className="teaching-item-line">
                          <strong>{item.label}</strong>
                          <small>
                            {item.type === "content_block"
                              ? getBlockLabel(item.blockType)
                              : "练习"}
                          </small>
                        </span>
                        {item.type === "content_block" &&
                        item.blockType === "image" ? (
                          <label className="teaching-image-fit">
                            图片展示
                            <select
                              onChange={(event) =>
                                editItems((current) =>
                                  current.map((currentItem) =>
                                    currentItem.key === item.key &&
                                    currentItem.type === "content_block"
                                      ? {
                                          ...currentItem,
                                          imageFit: event.target.value as
                                            "fit" | "fill" | "original",
                                        }
                                      : currentItem,
                                  ),
                                )
                              }
                              value={item.imageFit}
                            >
                              <option value="fit">适应画布</option>
                              <option value="fill">填满区域</option>
                              <option value="original">原始比例</option>
                            </select>
                          </label>
                        ) : null}
                      </div>
                      <div className="teaching-item-actions">
                        <button
                          aria-label={`上移第 ${index + 1} 项`}
                          className="inline-icon-button"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          title="上移"
                          type="button"
                        >
                          <ArrowUp aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`下移第 ${index + 1} 项`}
                          className="inline-icon-button"
                          disabled={index === items.length - 1}
                          onClick={() => move(index, 1)}
                          title="下移"
                          type="button"
                        >
                          <ArrowDown aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`移除第 ${index + 1} 项`}
                          className="inline-icon-button danger"
                          onClick={() =>
                            editItems((current) =>
                              current.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            )
                          }
                          title="移除"
                          type="button"
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          )}
        </section>

        <aside
          className="editor-pane teaching-source-pane"
          aria-label="内容素材"
        >
          <div
            aria-label="内容来源"
            className="segmented-control teaching-source-tabs"
            role="group"
          >
            <button
              aria-pressed={sourceTab === "document"}
              className={sourceTab === "document" ? "active" : ""}
              onClick={() => setSourceTab("document")}
              type="button"
            >
              文档段落
            </button>
            <button
              aria-pressed={sourceTab === "exercise"}
              className={sourceTab === "exercise" ? "active" : ""}
              onClick={() => setSourceTab("exercise")}
              type="button"
            >
              嵌套练习
            </button>
          </div>

          <div className="teaching-source-body">
            {sourceTab === "document" ? (
              <>
                <select
                  aria-label="选择文档"
                  className="select teaching-source-select"
                  onChange={(event) => setSelectedFileId(event.target.value)}
                  value={selectedFileId}
                >
                  {files.length ? null : <option value="">暂无文档</option>}
                  {files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.title}
                    </option>
                  ))}
                </select>

                {blocks.length ? (
                  <div className="teaching-picker-tools">
                    <span>{blocks.length} 个段落</span>
                    <button
                      onClick={() =>
                        setSelectedBlockIds((current) =>
                          current.size === blocks.length
                            ? new Set()
                            : new Set(blocks.map((block) => block.id)),
                        )
                      }
                      type="button"
                    >
                      {selectedBlockIds.size === blocks.length
                        ? "取消全选"
                        : "全选"}
                    </button>
                  </div>
                ) : null}

                <div className="teaching-picker-list">
                  {blocks.length === 0 ? (
                    <p className="teaching-picker-empty">
                      这个文档暂无可选段落。
                    </p>
                  ) : null}
                  {blocks.map((block) => {
                    const checked = selectedBlockIds.has(block.id);
                    return (
                      <label
                        className={
                          checked
                            ? "teaching-pick-row selected"
                            : "teaching-pick-row"
                        }
                        key={block.id}
                      >
                        <input
                          checked={checked}
                          onChange={(event) =>
                            toggleId(
                              setSelectedBlockIds,
                              block.id,
                              event.target.checked,
                            )
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
                </div>
              </>
            ) : (
              <>
                {exercises.length ? (
                  <div className="teaching-picker-tools">
                    <span>{exercises.length} 个练习</span>
                  </div>
                ) : null}
                <div className="teaching-picker-list">
                  {exercises.length === 0 ? (
                    <p className="teaching-picker-empty">
                      这个课堂还没有可嵌入的练习。
                    </p>
                  ) : null}
                  {exercises.map((exercise) => {
                    const checked = selectedExerciseIds.has(exercise.id);
                    return (
                      <label
                        className={
                          checked
                            ? "teaching-pick-row selected"
                            : "teaching-pick-row"
                        }
                        key={exercise.id}
                      >
                        <input
                          checked={checked}
                          onChange={(event) =>
                            toggleId(
                              setSelectedExerciseIds,
                              exercise.id,
                              event.target.checked,
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          <small>{exercise.questionCount} 题</small>
                          {exercise.title}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="teaching-source-actions">
            <button
              className="button"
              disabled={!selectedCount}
              onClick={addSelected}
              type="button"
            >
              <Plus aria-hidden="true" className="button-icon" />
              {selectedCount ? `添加 ${selectedCount} 项` : "添加到课件"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function getTeachingImageFit(block: ContentBlock | null) {
  if (!block || !block.dataJson || typeof block.dataJson !== "object") {
    return "fit" as const;
  }
  const value = (block.dataJson as { teachingImageFit?: unknown })
    .teachingImageFit;
  return value === "fill" || value === "original" ? value : "fit";
}
