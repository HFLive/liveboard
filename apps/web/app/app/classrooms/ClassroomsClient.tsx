"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import type {
  ClassroomMemberRole,
  ClassroomSummary,
  UserTagSummary,
  UserSummary,
} from "@liveboard/shared";
import {
  createClassroom,
  getMe,
  listClassrooms,
  listVisibilityUsers,
} from "@/lib/api";
import { classroomDetail } from "@/lib/routes";

type DraftRole = ClassroomMemberRole | "none";

/** 管理员可查看的课堂范围：实际参与（课堂成员）或全部可见课堂。 */
type ClassroomListView = "joined" | "all";

function ClassroomCardSkeletons() {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
        <div
          aria-hidden="true"
          className="classroom-row classroom-row-skeleton"
          key={index}
        >
          <span className="classroom-skeleton-head">
            <span className="skeleton-block classroom-skeleton-title" />
            <span className="skeleton-block classroom-skeleton-role" />
          </span>
          <span className="skeleton-block classroom-skeleton-description" />
          <span className="classroom-skeleton-stats">
            <span className="skeleton-block classroom-skeleton-stat" />
          </span>
        </div>
      ))}
    </>
  );
}

export function ClassroomsClient() {
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [tags, setTags] = useState<UserTagSummary[]>([]);
  const [memberTagFilter, setMemberTagFilter] = useState("all");
  const [memberQuery, setMemberQuery] = useState("");
  const [roles, setRoles] = useState<Record<string, DraftRole>>({});
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [view, setView] = useState<ClassroomListView>("joined");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    // 管理员可查看的课堂包含未参与的（role 为 administrator），
    // 「我参与的」只保留具有教师/学生身份的课堂。
    const items =
      view === "joined"
        ? classrooms.filter((classroom) => classroom.role !== "administrator")
        : classrooms;
    const value = query.trim().toLowerCase();
    return value
      ? items.filter((classroom) =>
          `${classroom.name} ${classroom.description ?? ""}`
            .toLowerCase()
            .includes(value),
        )
      : items;
  }, [classrooms, query, view]);

  const filteredUsers = useMemo(() => {
    const value = memberQuery.trim().toLowerCase();
    return users.filter((user) => {
      if (
        memberTagFilter !== "all" &&
        !user.tags?.some((tag) => tag.id === memberTagFilter)
      ) {
        return false;
      }
      return value
        ? `${user.displayName} ${user.username}`.toLowerCase().includes(value)
        : true;
    });
  }, [users, memberTagFilter, memberQuery]);

  const selectedCounts = useMemo(() => {
    let teacher = 0;
    let student = 0;
    for (const role of Object.values(roles)) {
      if (role === "teacher") teacher += 1;
      if (role === "student") student += 1;
    }
    return { teacher, student, total: teacher + student };
  }, [roles]);

  useEffect(() => {
    Promise.all([listClassrooms(), getMe()])
      .then(async ([classroomResult, meResult]) => {
        setClassrooms(classroomResult.classrooms);
        const isAdmin = ["super_admin", "admin"].includes(
          meResult.user.systemRole,
        );
        setMeId(meResult.user.id);
        setCanCreate(isAdmin);
        // 课堂列表已可用时就结束主区域的加载状态。成员目录只供新建弹窗使用，
        // 不应让列表骨架与真实课堂卡片同时存在。
        setLoading(false);
        if (isAdmin) {
          const userResult = await listVisibilityUsers();
          setUsers(userResult.users);
          setTags(userResult.tags);
        }
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载课堂失败"),
      )
      .finally(() => setLoading(false));
  }, []);

  function openCreate() {
    // 默认把创建者设为教师：管理员创建课堂后只有教师能继续管理，
    // 不把自己设为教师就会在创建后失去编辑权限。
    setRoles((current) =>
      meId && !(meId in current) ? { ...current, [meId]: "teacher" } : current,
    );
    setShowCreate(true);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const teacherUserIds = Object.entries(roles)
      .filter(([, role]) => role === "teacher")
      .map(([userId]) => userId);
    if (!name.trim()) {
      setError("请输入课堂名称");
      return;
    }
    if (!teacherUserIds.length) {
      setError("课堂至少需要一名教师");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createClassroom({
        name: name.trim(),
        description: description.trim() || undefined,
        teacherUserIds,
        studentUserIds: Object.entries(roles)
          .filter(([, role]) => role === "student")
          .map(([userId]) => userId),
      });
      setClassrooms((current) => [
        {
          ...result.classroom,
          members: undefined,
        },
        ...current,
      ]);
      setName("");
      setDescription("");
      setRoles({});
      setShowCreate(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建课堂失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workspace classrooms-workspace">
      {error ? <p className="error-text">{error}</p> : null}
      <div className="list-toolbar classrooms-toolbar">
        <label className="search-field">
          <Search aria-hidden="true" />
          <input
            aria-label="搜索课堂"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索课堂"
            value={query}
          />
        </label>
        {canCreate ? (
          <div className="classrooms-toolbar-actions">
            <div
              aria-label="课堂范围"
              className="segmented-control classrooms-view-switch"
              role="group"
            >
              <button
                aria-pressed={view === "joined"}
                className={view === "joined" ? "active" : ""}
                onClick={() => setView("joined")}
                type="button"
              >
                我参与的
              </button>
              <button
                aria-pressed={view === "all"}
                className={view === "all" ? "active" : ""}
                onClick={() => setView("all")}
                type="button"
              >
                全部
              </button>
            </div>
            <button
              aria-label="新建课堂"
              className="button mobile-icon-action"
              onClick={openCreate}
              title="新建课堂"
              type="button"
            >
              <Plus aria-hidden="true" className="button-icon" />
              新建课堂
            </button>
          </div>
        ) : null}
      </div>

      <section className="classroom-list" aria-label="课堂列表">
        {loading ? (
          <>
            <span className="sr-only" role="status">
              正在加载课堂
            </span>
            <ClassroomCardSkeletons />
          </>
        ) : null}
        {filtered.map((classroom) => (
          <Link
            className="classroom-row"
            href={classroomDetail(classroom.id)}
            key={classroom.id}
          >
            <span className="classroom-row-head">
              <strong>{classroom.name}</strong>
              <em>
                {classroom.role === "teacher"
                  ? "教师"
                  : classroom.role === "student"
                    ? "学生"
                    : "管理员"}
              </em>
            </span>
            {classroom.description ? (
              <small className="classroom-row-desc">
                {classroom.description}
              </small>
            ) : null}
            <span className="classroom-row-stats">
              课件 {classroom.deckCount} · 练习 {classroom.exerciseCount}
            </span>
          </Link>
        ))}
        {!loading && filtered.length === 0 ? (
          <div className="empty-panel classroom-empty">
            <strong>{classrooms.length ? "没有匹配的课堂" : "暂无课堂"}</strong>
            <span>
              {canCreate
                ? "新建课堂并指派教师和学生。"
                : "管理员将你加入课堂后，会显示在这里。"}
            </span>
          </div>
        ) : null}
      </section>

      {showCreate ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="create-classroom-title"
            className="modal-panel classroom-create-modal"
            onSubmit={onCreate}
          >
            <div className="modal-head">
              <h2 id="create-classroom-title">新建课堂</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowCreate(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body classroom-create-body">
              <label className="label">
                课堂名称
                <input
                  className="input"
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </label>
              <label className="label">
                课堂说明
                <textarea
                  className="textarea"
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  value={description}
                />
              </label>
              <div className="classroom-member-assignment">
                <div className="classroom-member-assignment-head">
                  <div>
                    <strong>指派教师和学生</strong>
                    <span>至少选择一名教师，成员角色之后仍可调整。</span>
                  </div>
                  {selectedCounts.total ? (
                    <span className="classroom-member-assignment-count">
                      已选教师 {selectedCounts.teacher} · 学生{" "}
                      {selectedCounts.student}
                    </span>
                  ) : null}
                </div>
                {meId && roles[meId] !== "teacher" ? (
                  <p className="classroom-create-owner-warning">
                    你是创建者，如果没把自己设为教师，创建后就只能查看这个课堂，无法再编辑课堂内容。
                  </p>
                ) : null}
                <div className="classroom-member-filters">
                  <label className="search-field">
                    <Search aria-hidden="true" />
                    <input
                      aria-label="搜索成员"
                      onChange={(event) => setMemberQuery(event.target.value)}
                      placeholder="搜索成员"
                      value={memberQuery}
                    />
                  </label>
                  {tags.length ? (
                    <select
                      aria-label="按成员标签筛选"
                      className="select compact-select classroom-tag-filter"
                      onChange={(event) =>
                        setMemberTagFilter(event.target.value)
                      }
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
                <div className="classroom-member-options">
                  {filteredUsers.length ? (
                    filteredUsers.map((user) => (
                      <label className="classroom-member-option" key={user.id}>
                        <span className="classroom-member-option-main">
                          <strong>{user.displayName}</strong>
                          <small>
                            @{user.username}
                            {user.tags?.length
                              ? ` · ${user.tags.map((tag) => tag.name).join("、")}`
                              : ""}
                          </small>
                        </span>
                        <select
                          className="select compact-select"
                          onChange={(event) =>
                            setRoles((current) => ({
                              ...current,
                              [user.id]: event.target.value as DraftRole,
                            }))
                          }
                          value={roles[user.id] ?? "none"}
                        >
                          <option value="none">不加入</option>
                          <option value="teacher">教师</option>
                          <option value="student">学生</option>
                        </select>
                      </label>
                    ))
                  ) : (
                    <p className="classroom-add-members-empty">
                      没有匹配的成员，调整标签或搜索词试试。
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setShowCreate(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="button" disabled={saving} type="submit">
                  {saving ? "创建中" : "创建课堂"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
