"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  ClassroomAnnouncementSummary,
  ClassroomMemberRole,
  TeachingDeckSummary,
  UserTagSummary,
  UserSummary,
} from "@liveboard/shared";
import {
  apiResourceUrl,
  ClassroomDetail,
  ClassroomFileSummary,
  createClassroomAnnouncement,
  deleteClassroom,
  deleteClassroomAnnouncement,
  deleteClassroomFile,
  deleteTeachingDeck,
  ExerciseSetSummary,
  getClassroom,
  listClassroomFiles,
  listExerciseSets,
  listTeachingDecks,
  listVisibilityUsers,
  removeClassroomMember,
  uploadClassroomFile,
  updateClassroomAnnouncement,
  updateClassroom,
  upsertClassroomMember,
} from "@/lib/api";
import {
  APP_ROUTES,
  classroomDetail,
  classroomExerciseNew,
  classroomTeachingNew,
  exerciseDetail,
  exerciseEdit,
  exerciseSubmissions,
  teachingEdit,
  teachingPresent,
} from "@/lib/routes";
import { formatDateTime, formatRelativeTime } from "@/lib/labels";
import { UserProfileLink } from "@/components/UserProfileLink";
import { SkeletonRows } from "@/components/system/ProgressiveLoading";

export type ClassroomTab =
  "announcements" | "teaching" | "exercises" | "files" | "members";

export function ClassroomDetailClient({
  classroomId,
  initialTab,
}: {
  classroomId: string;
  initialTab?: ClassroomTab;
}) {
  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [decks, setDecks] = useState<TeachingDeckSummary[]>([]);
  const [exercises, setExercises] = useState<ExerciseSetSummary[]>([]);
  const [files, setFiles] = useState<ClassroomFileSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [tags, setTags] = useState<UserTagSummary[]>([]);
  const [memberTagFilter, setMemberTagFilter] = useState("all");
  const [memberQuery, setMemberQuery] = useState("");
  const [tab, setTab] = useState<ClassroomTab>(initialTab ?? "announcements");
  const [query, setQuery] = useState("");
  const [editingAnnouncement, setEditingAnnouncement] =
    useState<ClassroomAnnouncementSummary | null>(null);
  const [showAnnouncementEditor, setShowAnnouncementEditor] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementContent, setAnnouncementContent] = useState("");
  const [showClassroomEditor, setShowClassroomEditor] = useState(false);
  const [classroomName, setClassroomName] = useState("");
  const [classroomDescription, setClassroomDescription] = useState("");
  const [showClassroomDelete, setShowClassroomDelete] = useState(false);
  const [classroomDeleteStep, setClassroomDeleteStep] = useState<1 | 2>(1);
  const [classroomDeleteConfirmation, setClassroomDeleteConfirmation] =
    useState("");
  const [loading, setLoading] = useState(true);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [savingClassroom, setSavingClassroom] = useState(false);
  const [deletingClassroom, setDeletingClassroom] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const addableUsers = useMemo(() => {
    const memberIds = new Set(
      classroom?.members?.map((member) => member.user.id) ?? [],
    );
    return users.filter((user) => !memberIds.has(user.id));
  }, [classroom?.members, users]);
  const matchingUsers = useMemo(() => {
    const normalizedMemberQuery = memberQuery.trim().toLowerCase();
    return addableUsers.filter(
      (user) =>
        (memberTagFilter === "all" ||
          user.tags?.some((tag) => tag.id === memberTagFilter)) &&
        (!normalizedMemberQuery ||
          `${user.displayName} ${user.username}`
            .toLowerCase()
            .includes(normalizedMemberQuery)),
    );
  }, [addableUsers, memberQuery, memberTagFilter]);
  const normalizedQuery = query.trim().toLowerCase();

  async function load() {
    const [classroomResult, deckResult, exerciseResult, fileResult] =
      await Promise.all([
        getClassroom(classroomId),
        listTeachingDecks(classroomId),
        listExerciseSets(classroomId),
        listClassroomFiles(classroomId),
      ]);
    setClassroom(classroomResult.classroom);
    setDecks(deckResult.decks);
    setExercises(exerciseResult.exerciseSets);
    setFiles(fileResult.files);
    if (classroomResult.classroom.canManageMembers) {
      const userResult = await listVisibilityUsers();
      setUsers(userResult.users);
      setTags(userResult.tags);
    }
  }

  useEffect(() => {
    load()
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载课堂失败"),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  // 浏览器前进/后退或从子页面带 ?tab= 返回时，同步 URL 中的标签。
  useEffect(() => {
    const next = initialTab ?? "announcements";
    setTab((current) => (current === next ? current : next));
  }, [initialTab]);

  // 无权管理成员的用户不应停在成员标签（手动输入 ?tab=members 的情况）。
  useEffect(() => {
    if (classroom && tab === "members" && !classroom.canManageMembers) {
      selectTab("announcements");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom, tab]);

  function selectTab(next: ClassroomTab) {
    setTab(next);
    router.replace(classroomDetail(classroomId, next), { scroll: false });
  }

  async function changeMember(
    userId: string,
    role: ClassroomMemberRole | "remove",
  ) {
    setError(null);
    try {
      const result =
        role === "remove"
          ? await removeClassroomMember(classroomId, userId)
          : await upsertClassroomMember(classroomId, userId, role);
      setClassroom(result.classroom);
      setMessage(role === "remove" ? "成员已移出课堂" : "成员角色已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新成员失败");
    }
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadClassroomFile(classroomId, file);
      setFiles((current) => [result.file, ...current]);
      setClassroom((current) =>
        current
          ? {
              ...current,
              storageUsedBytes:
                current.storageUsedBytes + result.file.sizeBytes,
              fileCount: current.fileCount + 1,
            }
          : current,
      );
      setMessage("课堂文件已上传");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function onDeleteFile(file: ClassroomFileSummary) {
    if (!window.confirm(`确定删除课堂文件“${file.filename}”吗？`)) return;
    try {
      await deleteClassroomFile(classroomId, file.id);
      setFiles((current) => current.filter((item) => item.id !== file.id));
      setClassroom((current) =>
        current
          ? {
              ...current,
              storageUsedBytes: Math.max(
                0,
                current.storageUsedBytes - file.sizeBytes,
              ),
              fileCount: Math.max(0, current.fileCount - 1),
            }
          : current,
      );
      setMessage("课堂文件已删除");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    }
  }

  async function onDeleteDeck(deck: TeachingDeckSummary) {
    if (!window.confirm(`确定删除课件“${deck.title}”吗？`)) return;
    try {
      await deleteTeachingDeck(deck.id);
      setDecks((current) => current.filter((item) => item.id !== deck.id));
      setMessage("课件已删除");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除课件失败");
    }
  }

  function openClassroomEditor() {
    if (!classroom) return;
    setClassroomName(classroom.name);
    setClassroomDescription(classroom.description ?? "");
    setShowClassroomEditor(true);
  }

  async function saveClassroom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classroomName.trim()) {
      setError("请输入课堂名称");
      return;
    }
    setSavingClassroom(true);
    setError(null);
    try {
      const result = await updateClassroom(classroomId, {
        name: classroomName.trim(),
        description: classroomDescription.trim(),
      });
      setClassroom(result.classroom);
      setShowClassroomEditor(false);
      setMessage("课堂信息已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新课堂失败");
    } finally {
      setSavingClassroom(false);
    }
  }

  function openClassroomDelete() {
    setShowClassroomEditor(false);
    setClassroomDeleteStep(1);
    setClassroomDeleteConfirmation("");
    setShowClassroomDelete(true);
  }

  function closeClassroomDelete() {
    if (deletingClassroom) return;
    setShowClassroomDelete(false);
    setClassroomDeleteStep(1);
    setClassroomDeleteConfirmation("");
  }

  async function onDeleteClassroom() {
    if (!classroom || classroomDeleteConfirmation !== classroom.name) return;
    setDeletingClassroom(true);
    setError(null);
    try {
      await deleteClassroom(classroomId);
      router.replace(APP_ROUTES.classrooms);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除课堂失败");
      setDeletingClassroom(false);
      setShowClassroomDelete(false);
    }
  }

  function openAnnouncementEditor(announcement?: ClassroomAnnouncementSummary) {
    setEditingAnnouncement(announcement ?? null);
    setAnnouncementTitle(announcement?.title ?? "");
    setAnnouncementContent(announcement?.content ?? "");
    setShowAnnouncementEditor(true);
  }

  function closeAnnouncementEditor() {
    setShowAnnouncementEditor(false);
    setEditingAnnouncement(null);
    setAnnouncementTitle("");
    setAnnouncementContent("");
  }

  async function saveAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!announcementTitle.trim() || !announcementContent.trim()) {
      setError("请填写公告标题和内容");
      return;
    }
    setSavingAnnouncement(true);
    setError(null);
    try {
      const result = editingAnnouncement
        ? await updateClassroomAnnouncement(
            classroomId,
            editingAnnouncement.id,
            {
              title: announcementTitle.trim(),
              content: announcementContent.trim(),
            },
          )
        : await createClassroomAnnouncement(classroomId, {
            title: announcementTitle.trim(),
            content: announcementContent.trim(),
          });
      setClassroom((current) =>
        current
          ? {
              ...current,
              announcements: editingAnnouncement
                ? current.announcements.map((announcement) =>
                    announcement.id === result.announcement.id
                      ? result.announcement
                      : announcement,
                  )
                : [result.announcement, ...current.announcements],
            }
          : current,
      );
      setMessage(editingAnnouncement ? "公告已更新" : "公告已发布");
      closeAnnouncementEditor();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存公告失败");
    } finally {
      setSavingAnnouncement(false);
    }
  }

  async function onDeleteAnnouncement(
    announcement: ClassroomAnnouncementSummary,
  ) {
    if (!window.confirm(`确定删除公告“${announcement.title}”吗？`)) return;
    setError(null);
    try {
      await deleteClassroomAnnouncement(classroomId, announcement.id);
      setClassroom((current) =>
        current
          ? {
              ...current,
              announcements: current.announcements.filter(
                (item) => item.id !== announcement.id,
              ),
            }
          : current,
      );
      setMessage("公告已删除");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除公告失败");
    }
  }

  if (loading) {
    return (
      <div className="workspace classroom-detail-workspace">
        <SkeletonRows count={6} />
      </div>
    );
  }
  if (!classroom) {
    return (
      <div className="workspace classroom-detail-workspace">
        <p className="error-text">{error ?? "课堂不存在"}</p>
      </div>
    );
  }

  const filteredDecks = decks.filter((deck) =>
    normalizedQuery ? deck.title.toLowerCase().includes(normalizedQuery) : true,
  );
  const filteredExercises = exercises.filter((exercise) =>
    normalizedQuery
      ? exercise.title.toLowerCase().includes(normalizedQuery)
      : true,
  );
  const filteredFiles = files.filter((file) =>
    normalizedQuery
      ? file.filename.toLowerCase().includes(normalizedQuery)
      : true,
  );
  const filteredAnnouncements = classroom.announcements.filter(
    (announcement) =>
      normalizedQuery
        ? `${announcement.title} ${announcement.content}`
            .toLowerCase()
            .includes(normalizedQuery)
        : true,
  );

  return (
    <div className="workspace classroom-detail-workspace">
      <Link className="page-back-link" href={APP_ROUTES.classrooms}>
        <ArrowLeft aria-hidden="true" />
        返回课堂
      </Link>
      <header className="classroom-detail-head">
        <div>
          <h1>{classroom.name}</h1>
          <p>{classroom.description || "暂无课堂说明"}</p>
        </div>
        <div className="classroom-detail-meta">
          <dl>
            <div>
              <dt>教师</dt>
              <dd>{classroom.teacherCount}</dd>
            </div>
            <div>
              <dt>学生</dt>
              <dd>{classroom.studentCount}</dd>
            </div>
          </dl>
          {classroom.canEditClassroom ? (
            <button
              className="button secondary"
              onClick={openClassroomEditor}
              type="button"
            >
              <Pencil aria-hidden="true" className="button-icon" />
              编辑课堂
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <div className="segmented-control classroom-tabs" aria-label="课堂内容">
        <button
          className={tab === "announcements" ? "active" : ""}
          onClick={() => selectTab("announcements")}
          type="button"
        >
          公告
          <span className="classroom-tab-count">
            {classroom.announcements.length}
          </span>
        </button>
        <button
          className={tab === "teaching" ? "active" : ""}
          onClick={() => selectTab("teaching")}
          type="button"
        >
          课件
          <span className="classroom-tab-count">{decks.length}</span>
        </button>
        <button
          className={tab === "exercises" ? "active" : ""}
          onClick={() => selectTab("exercises")}
          type="button"
        >
          练习
          <span className="classroom-tab-count">{exercises.length}</span>
        </button>
        <button
          className={tab === "files" ? "active" : ""}
          onClick={() => selectTab("files")}
          type="button"
        >
          文件
          <span className="classroom-tab-count">{files.length}</span>
        </button>
        {classroom.canManageMembers ? (
          <button
            className={tab === "members" ? "active" : ""}
            onClick={() => selectTab("members")}
            type="button"
          >
            成员
            <span className="classroom-tab-count">
              {classroom.members?.length ?? 0}
            </span>
          </button>
        ) : null}
      </div>

      {tab !== "members" ? (
        <div className="list-toolbar classroom-content-toolbar">
          <label className="search-field">
            <Search aria-hidden="true" />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`搜索${tab === "announcements" ? "公告" : tab === "teaching" ? "课件" : tab === "exercises" ? "练习" : "文件"}`}
              value={query}
            />
          </label>
          {classroom.canEditContent && tab === "announcements" ? (
            <button
              className="button"
              onClick={() => openAnnouncementEditor()}
              type="button"
            >
              <Plus aria-hidden="true" className="button-icon" />
              发布公告
            </button>
          ) : null}
          {classroom.canEditContent && tab === "teaching" ? (
            <Link className="button" href={classroomTeachingNew(classroomId)}>
              <Plus aria-hidden="true" className="button-icon" />
              创建课件
            </Link>
          ) : null}
          {classroom.canEditContent && tab === "exercises" ? (
            <Link className="button" href={classroomExerciseNew(classroomId)}>
              <Plus aria-hidden="true" className="button-icon" />
              创建练习
            </Link>
          ) : null}
          {tab === "files" ? (
            <span className="classroom-section-caption">
              课堂文件已用 {formatFileSize(classroom.storageUsedBytes)} / 上限{" "}
              {formatFileSize(classroom.storageQuotaBytes)}
            </span>
          ) : null}
          {classroom.canEditContent && tab === "files" ? (
            <>
              <button
                className="button classroom-upload-button"
                disabled={
                  uploading ||
                  classroom.storageUsedBytes >= classroom.storageQuotaBytes
                }
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <Upload aria-hidden="true" className="button-icon" />
                {uploading ? "上传中" : "上传文件"}
              </button>
              <input
                className="classroom-upload-input"
                disabled={uploading}
                onChange={(event) => void onUpload(event)}
                ref={fileInputRef}
                type="file"
              />
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "announcements" ? (
        <section aria-label="课堂公告" className="classroom-announcement-list">
          {filteredAnnouncements.map((announcement) => (
            <article className="classroom-announcement" key={announcement.id}>
              <header>
                <div>
                  <h2>{announcement.title}</h2>
                  <small>
                    <UserProfileLink user={announcement.author} /> ·{" "}
                    {formatDateTime(announcement.createdAt)}
                    {announcement.updatedAt !== announcement.createdAt
                      ? " · 已编辑"
                      : ""}
                  </small>
                </div>
                {classroom.canEditContent ? (
                  <div className="classroom-announcement-actions">
                    <button
                      className="icon-button subtle"
                      onClick={() => openAnnouncementEditor(announcement)}
                      title="编辑公告"
                      type="button"
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => void onDeleteAnnouncement(announcement)}
                      title="删除公告"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </header>
              <p>{announcement.content}</p>
            </article>
          ))}
          {filteredAnnouncements.length === 0 ? (
            normalizedQuery ? (
              <ClassroomEmpty
                detail="换个关键词试试。"
                title="没有匹配的公告"
              />
            ) : (
              <ClassroomEmpty
                detail={
                  classroom.canEditContent
                    ? "发布第一条课堂通知。"
                    : "教师尚未发布课堂通知。"
                }
                title="暂无公告"
              />
            )
          ) : null}
        </section>
      ) : null}

      {tab === "teaching" ? (
        <section className="classroom-resource-list">
          {filteredDecks.map((deck) => (
            <article className="classroom-resource-row" key={deck.id}>
              <span className="classroom-resource-main">
                <Link
                  className="classroom-resource-link"
                  href={teachingPresent(deck.id)}
                >
                  {deck.title}
                </Link>
                <small>
                  <UserProfileLink user={deck.createdBy} /> ·{" "}
                  {formatRelativeTime(deck.updatedAt)}
                </small>
              </span>
              {deck.canEdit ? (
                <details className="editor-more-menu">
                  <summary className="icon-button subtle">
                    <MoreHorizontal aria-hidden="true" />
                  </summary>
                  <div className="context-menu">
                    <Link href={teachingEdit(deck.id)}>编辑课件</Link>
                    <button
                      className="danger"
                      onClick={() => void onDeleteDeck(deck)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" />
                      删除课件
                    </button>
                  </div>
                </details>
              ) : null}
            </article>
          ))}
          {filteredDecks.length === 0 ? (
            normalizedQuery ? (
              <ClassroomEmpty
                detail="换个关键词试试。"
                title="没有匹配的课件"
              />
            ) : (
              <ClassroomEmpty
                detail={
                  classroom.canEditContent
                    ? "创建第一份课件，课堂学生即可查看。"
                    : "教师尚未发布课件。"
                }
                title="暂无课件"
              />
            )
          ) : null}
        </section>
      ) : null}

      {tab === "exercises" ? (
        <section className="classroom-resource-list">
          {filteredExercises.map((exercise) => (
            <article className="classroom-resource-row" key={exercise.id}>
              <span className="classroom-resource-main">
                <Link
                  className="classroom-resource-link"
                  href={exerciseDetail(exercise.id)}
                >
                  {exercise.title}
                </Link>
                <small>
                  {exercise.questionCount} 题 ·{" "}
                  {formatRelativeTime(exercise.updatedAt)}
                </small>
              </span>
              {exercise.canManage ? (
                <span className="classroom-row-actions">
                  <Link
                    className="classroom-text-action"
                    href={exerciseEdit(exercise.id)}
                  >
                    编辑
                  </Link>
                  <Link
                    className="classroom-text-action"
                    href={exerciseSubmissions(exercise.id)}
                  >
                    批改
                  </Link>
                </span>
              ) : null}
            </article>
          ))}
          {filteredExercises.length === 0 ? (
            normalizedQuery ? (
              <ClassroomEmpty
                detail="换个关键词试试。"
                title="没有匹配的练习"
              />
            ) : (
              <ClassroomEmpty
                detail={
                  classroom.canEditContent
                    ? "创建练习后，只有本课堂学生可以作答。"
                    : "教师尚未发布练习。"
                }
                title="暂无练习"
              />
            )
          ) : null}
        </section>
      ) : null}

      {tab === "files" ? (
        <section className="classroom-resource-list">
          {filteredFiles.map((file) => (
            <article className="classroom-resource-row" key={file.id}>
              <span className="classroom-resource-main">
                <a
                  className="classroom-resource-link"
                  href={apiResourceUrl(file.url)}
                >
                  {file.filename}
                </a>
                <small>
                  {formatFileSize(file.sizeBytes)} ·{" "}
                  {formatDateTime(file.createdAt)}
                </small>
              </span>
              <a
                className="icon-button subtle"
                href={apiResourceUrl(file.url)}
                title="下载"
              >
                <Download aria-hidden="true" />
              </a>
              {classroom.canEditContent ? (
                <button
                  className="icon-button danger"
                  onClick={() => void onDeleteFile(file)}
                  title="删除"
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              ) : null}
            </article>
          ))}
          {filteredFiles.length === 0 ? (
            normalizedQuery ? (
              <ClassroomEmpty
                detail="换个关键词试试。"
                title="没有匹配的文件"
              />
            ) : (
              <ClassroomEmpty
                detail={
                  classroom.canEditContent
                    ? "上传 PDF、PPT 或其他课堂资料供学生下载。"
                    : "教师尚未上传课堂文件。"
                }
                title="暂无文件"
              />
            )
          ) : null}
        </section>
      ) : null}

      {tab === "members" && classroom.canManageMembers ? (
        <section className="classroom-members-panel">
          <div className="classroom-member-list">
            {classroom.members?.map((member) => (
              <div className="classroom-member-row" key={member.user.id}>
                <span>
                  <UserProfileLink user={member.user} />
                  <small>@{member.user.username}</small>
                </span>
                <select
                  aria-label={`${member.user.displayName}的课堂角色`}
                  className="select compact-select"
                  onChange={(event) =>
                    void changeMember(
                      member.user.id,
                      event.target.value as ClassroomMemberRole | "remove",
                    )
                  }
                  value={member.role}
                >
                  <option value="teacher">教师</option>
                  <option value="student">学生</option>
                  <option value="remove">移出课堂</option>
                </select>
              </div>
            ))}
          </div>
          {addableUsers.length ? (
            <div className="classroom-add-members">
              <h3>添加成员</h3>
              <div className="classroom-member-filters">
                <label className="search-field">
                  <Search aria-hidden="true" />
                  <input
                    aria-label="搜索可添加成员"
                    onChange={(event) => setMemberQuery(event.target.value)}
                    placeholder="搜索成员"
                    value={memberQuery}
                  />
                </label>
                {tags.length ? (
                  <select
                    aria-label="按成员标签筛选"
                    className="select compact-select"
                    onChange={(event) => setMemberTagFilter(event.target.value)}
                    value={memberTagFilter}
                  >
                    <option value="all">全部标签</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {matchingUsers.length ? (
                matchingUsers.map((user) => (
                  <div className="classroom-member-row" key={user.id}>
                    <span>{user.displayName}</span>
                    <div>
                      <button
                        className="classroom-text-action"
                        onClick={() => void changeMember(user.id, "student")}
                        type="button"
                      >
                        添加为学生
                      </button>
                      <button
                        className="classroom-text-action"
                        onClick={() => void changeMember(user.id, "teacher")}
                        type="button"
                      >
                        添加为教师
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="classroom-add-members-empty">
                  没有匹配的成员，调整标签或搜索词试试。
                </p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {showClassroomEditor ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="classroom-editor-title"
            className="modal-panel classroom-editor-modal"
            onSubmit={(event) => void saveClassroom(event)}
          >
            <div className="modal-head">
              <h2 id="classroom-editor-title">编辑课堂</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowClassroomEditor(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body classroom-announcement-form">
              <label className="label">
                课堂名称
                <input
                  autoFocus
                  className="input"
                  maxLength={120}
                  onChange={(event) => setClassroomName(event.target.value)}
                  value={classroomName}
                />
              </label>
              <label className="label">
                课堂说明
                <textarea
                  className="textarea"
                  maxLength={500}
                  onChange={(event) =>
                    setClassroomDescription(event.target.value)
                  }
                  rows={4}
                  value={classroomDescription}
                />
              </label>
              <div className="classroom-editor-danger">
                <span className="muted">
                  删除课堂将永久移除其中的课件、练习、文件和公告。
                </span>
                <button
                  className="button danger"
                  onClick={openClassroomDelete}
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="button-icon" />
                  删除课堂
                </button>
              </div>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={savingClassroom}
                  onClick={() => setShowClassroomEditor(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="button" disabled={savingClassroom}>
                  {savingClassroom ? "保存中" : "保存课堂"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {showClassroomDelete ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="classroom-delete-title"
            aria-modal="true"
            className="modal-panel classroom-delete-modal"
            role="dialog"
          >
            <div className="modal-head">
              <h2 id="classroom-delete-title">
                {classroomDeleteStep === 1 ? "删除课堂？" : "再次确认删除"}
              </h2>
              <button
                className="icon-button subtle"
                disabled={deletingClassroom}
                onClick={closeClassroomDelete}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              {classroomDeleteStep === 1 ? (
                <>
                  <div className="classroom-delete-warning">
                    <strong>此操作无法撤销</strong>
                    <span>
                      {`将永久删除课堂“${classroom.name}”，包括 ${decks.length} 份课件、${exercises.length} 个练习、${files.length} 份课堂文件和 ${classroom.announcements.length} 条公告，练习的提交记录一并移除。`}
                    </span>
                  </div>
                  <p className="muted">
                    课堂文件会同时从对象存储中删除并释放占用空间，全部成员将失去访问。
                  </p>
                </>
              ) : (
                <label className="label">
                  输入课堂名称“{classroom.name}”以确认
                  <input
                    autoFocus
                    className="input"
                    disabled={deletingClassroom}
                    onChange={(event) =>
                      setClassroomDeleteConfirmation(event.target.value)
                    }
                    value={classroomDeleteConfirmation}
                  />
                </label>
              )}
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={deletingClassroom}
                  onClick={
                    classroomDeleteStep === 1
                      ? closeClassroomDelete
                      : () => {
                          setClassroomDeleteStep(1);
                          setClassroomDeleteConfirmation("");
                        }
                  }
                  type="button"
                >
                  {classroomDeleteStep === 1 ? "取消" : "返回"}
                </button>
                {classroomDeleteStep === 1 ? (
                  <button
                    className="button danger"
                    onClick={() => setClassroomDeleteStep(2)}
                    type="button"
                  >
                    继续删除
                  </button>
                ) : (
                  <button
                    className="button danger"
                    disabled={
                      deletingClassroom ||
                      classroomDeleteConfirmation !== classroom.name
                    }
                    onClick={() => void onDeleteClassroom()}
                    type="button"
                  >
                    {deletingClassroom ? "正在删除…" : "永久删除"}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {showAnnouncementEditor ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="announcement-editor-title"
            className="modal-panel classroom-announcement-modal"
            onSubmit={(event) => void saveAnnouncement(event)}
          >
            <div className="modal-head">
              <h2 id="announcement-editor-title">
                {editingAnnouncement ? "编辑公告" : "发布公告"}
              </h2>
              <button
                className="icon-button subtle"
                onClick={closeAnnouncementEditor}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body classroom-announcement-form">
              <label className="label">
                公告标题
                <input
                  autoFocus
                  className="input"
                  maxLength={120}
                  onChange={(event) => setAnnouncementTitle(event.target.value)}
                  value={announcementTitle}
                />
              </label>
              <label className="label">
                公告内容
                <textarea
                  className="textarea"
                  maxLength={5000}
                  onChange={(event) =>
                    setAnnouncementContent(event.target.value)
                  }
                  rows={8}
                  value={announcementContent}
                />
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={savingAnnouncement}
                  onClick={closeAnnouncementEditor}
                  type="button"
                >
                  取消
                </button>
                <button className="button" disabled={savingAnnouncement}>
                  {savingAnnouncement
                    ? "保存中"
                    : editingAnnouncement
                      ? "保存公告"
                      : "发布公告"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ClassroomEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-panel classroom-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
