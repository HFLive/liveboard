"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ClipboardList,
  FileText,
  GripVertical,
  Plus,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { FileSummary, UserSummary } from "@liveboard/shared";
import {
  getResourceNameError,
  normalizeResourceName,
} from "@liveboard/shared/resource-name";
import {
  ContentBlock,
  createTeachingDeck,
  ExerciseSetSummary,
  getTeachingDeck,
  getMe,
  listBlocks,
  listExerciseSets,
  listFiles,
  listVisibilityUsers,
  updateTeachingDeck,
} from "@/lib/api";
import { UserVisibilityPicker } from "@/components/UserVisibilityPicker";
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
  const [canManageVisibility, setCanManageVisibility] = useState(!deckId);
  const [loading, setLoading] = useState(false);
  const [sourceTab, setSourceTab] = useState<"document" | "exercise">(
    "document",
  );
  const [draggingItemKey, setDraggingItemKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId],
  );

  useEffect(() => {
    Promise.all([
      listFiles(),
      listExerciseSets(),
      getMe(),
      listVisibilityUsers(),
      deckId ? getTeachingDeck(deckId) : Promise.resolve(null),
    ])
      .then(
        ([fileResult, exerciseResult, meResult, usersResult, deckResult]) => {
          const contentFiles = fileResult.files.filter(
            (file) => file.type !== "exercise_set" && file.type !== "asset",
          );
          setFiles(contentFiles);
          setExercises(exerciseResult.exerciseSets);
          setUsers(usersResult.users);
          setSelectedFileId(contentFiles[0]?.id ?? "");
          setSelectedExerciseId(exerciseResult.exerciseSets[0]?.id ?? "");
          if (deckResult) {
            if (!deckResult.deck.canEdit) {
              throw new Error("只有创建者或管理员可以编辑课件");
            }
            setTitle(deckResult.deck.title);
            setCreatorUserId(deckResult.deck.createdBy.id);
            setCanManageVisibility(deckResult.deck.canManageVisibility);
            setSelectedVisibleUserIds(
              new Set(
                deckResult.deck.visibleUserIds ?? [
                  deckResult.deck.createdBy.id,
                ],
              ),
            );
            setItems(
              deckResult.deck.items.reduce<DraftItem[]>((result, item) => {
                if (item.type === "content_block" && item.sourceBlockId) {
                  result.push({
                    key: item.id,
                    type: "content_block" as const,
                    sourceBlockId: item.sourceBlockId,
                    label: item.block
                      ? getBlockText(item.block) ||
                        getBlockLabel(item.block.type)
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
                    source: "嵌套练习",
                  });
                }
                return result;
              }, []),
            );
          } else {
            setCreatorUserId(meResult.user.id);
            setSelectedVisibleUserIds(new Set([meResult.user.id]));
          }
        },
      )
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
        blockType: block.type,
        imageFit: "fit" as const,
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

  function moveTo(itemKey: string, targetKey: string) {
    if (itemKey === targetKey) return;
    setItems((current) => {
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

  function openVisibilityModal() {
    setVisibilityDraftUserIds(new Set(selectedVisibleUserIds));
    setVisibilityQuery("");
    setShowVisibilityModal(true);
  }

  function confirmVisibility() {
    setSelectedVisibleUserIds(new Set(visibilityDraftUserIds));
    setShowVisibilityModal(false);
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
    setLoading(true);
    setError(null);
    const payload = {
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
      ...(canManageVisibility
        ? { visibleUserIds: [...selectedVisibleUserIds] }
        : {}),
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
      <Link className="page-back-link" href={APP_ROUTES.teaching}>
        <ArrowLeft aria-hidden="true" />
        <span>返回课件</span>
      </Link>
      <header className="page-head compact">
        <div>
          <p className="page-eyebrow">课件编辑</p>
          <h1>{deckId ? "编辑课件" : "创建课件"}</h1>
        </div>
      </header>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="workbench teaching-editor-layout">
        <div className="workbench-main teaching-editor-main">
          <div className="panel-head">
            <div>
              <h2>课件内容</h2>
            </div>
            <div className="teaching-editor-head-actions">
              <span className="teaching-editor-head-meta">
                按顺序排列，展示时自动分页
              </span>
              {canManageVisibility && creatorUserId ? (
                <button
                  className="button secondary teaching-visibility-button"
                  onClick={openVisibilityModal}
                  type="button"
                >
                  <Users aria-hidden="true" className="button-icon" />
                  可见范围（{selectedVisibleUserIds.size} 人）
                </button>
              ) : null}
            </div>
          </div>

          <div className="teaching-editor-settings">
            <label className="label teaching-title-field">
              课件名称
              <input
                className="input"
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：第一章课堂讲解"
                value={title}
              />
            </label>
          </div>

          <div className="teaching-item-list">
            {items.length === 0 ? (
              <p className="teaching-item-empty">
                课件还是空的，从文档段落或练习中添加内容。
              </p>
            ) : null}
            {items.map((item, index) => (
              <article
                className={`teaching-item-row ${draggingItemKey === item.key ? "dragging" : ""}`}
                key={item.key}
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
                <span aria-hidden="true" className="teaching-item-index">
                  {index + 1}
                </span>
                {item.type === "content_block" ? (
                  <FileText aria-hidden="true" />
                ) : (
                  <ClipboardList aria-hidden="true" />
                )}
                <div className="teaching-item-main">
                  <strong>{item.label}</strong>
                  <small>{item.source}</small>
                  {item.type === "content_block" &&
                  item.blockType === "image" ? (
                    <label className="teaching-image-fit">
                      图片展示
                      <select
                        onChange={(event) =>
                          setItems((current) =>
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
                      setItems((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    title="移除"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
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

        <aside className="workbench-side">
          <div
            className="segmented-control teaching-source-tabs"
            aria-label="内容来源"
          >
            <button
              className={sourceTab === "document" ? "active" : ""}
              onClick={() => setSourceTab("document")}
              type="button"
            >
              文档段落
            </button>
            <button
              className={sourceTab === "exercise" ? "active" : ""}
              onClick={() => setSourceTab("exercise")}
              type="button"
            >
              嵌套练习
            </button>
          </div>
          {sourceTab === "document" ? (
            <section className="action-panel teaching-source-panel">
              <h2>文档段落</h2>
              <label className="label">
                文档
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
              </label>
              <div className="teaching-block-picker">
                {blocks.length === 0 ? (
                  <p className="teaching-block-empty">这个文档暂无可选段落。</p>
                ) : null}
                {blocks.map((block) => {
                  const checked = selectedBlockIds.has(block.id);
                  return (
                    <label
                      className={
                        checked
                          ? "teaching-block-row selected"
                          : "teaching-block-row"
                      }
                      key={block.id}
                    >
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
              </div>
              <button
                className="button secondary"
                disabled={!selectedBlockIds.size}
                onClick={addBlocks}
                type="button"
              >
                <Plus aria-hidden="true" className="button-icon" /> 添加所选段落
              </button>
            </section>
          ) : null}

          {sourceTab === "exercise" ? (
            <section className="action-panel teaching-exercise-panel">
              <h2>嵌套练习</h2>
              <label className="label">
                练习
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
              </label>
              <button
                className="button secondary"
                disabled={!selectedExerciseId}
                onClick={addExercise}
                type="button"
              >
                <ClipboardList aria-hidden="true" className="button-icon" />{" "}
                添加练习
              </button>
            </section>
          ) : null}
        </aside>
      </div>
      {showVisibilityModal && creatorUserId ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="teaching-visibility-title"
            aria-modal="true"
            className="modal-panel teaching-visibility-modal"
            role="dialog"
          >
            <div className="modal-head">
              <h2 id="teaching-visibility-title">设置可见范围</h2>
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
                  onClick={confirmVisibility}
                  type="button"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
