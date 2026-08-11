"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AdminUserSummary,
  AuthMode,
  SystemRole,
  UserTagSummary,
  UserSummary,
} from "@liveboard/shared";
import {
  ExternalLink,
  FileUp,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import {
  bulkUpdateUserStatus,
  createUserTag,
  createUser,
  deleteUserTag,
  getAdminHfliveIdentity,
  getAuthCapabilities,
  getMe,
  hfliveSyncUser,
  importUsers as importUsersApi,
  type AdminHfliveIdentityDetail,
  type ImportUsersResult,
  listUsers,
  listUserTags,
  setUserTags,
  updateUserTag,
  updateUser,
} from "@/lib/api";
import {
  hfliveLinkMethodLabel,
  hfliveSyncStateLabel,
  roleLabel,
  userStatusLabel,
} from "@/lib/labels";
import { UserProfileLink } from "@/components/UserProfileLink";
import { AutoTextarea } from "@/components/AutoTextarea";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  FeedbackNotice,
  useFeedbackNotice,
} from "@/components/system/FeedbackNotice";
import { TableSkeletonRows } from "@/components/system/ProgressiveLoading";

type UserEditDraft = {
  username: string;
  displayName: string;
  systemRole: SystemRole;
  status: UserSummary["status"];
  password: string;
  aiCallLimit: string;
  tagIds: string[];
};

type ImportUserDraft = {
  username: string;
  displayName: string;
  password: string;
  systemRole: SystemRole;
};

type ParsedImport = {
  rows: ImportUserDraft[];
  errors: string[];
};

const csvExample =
  "username,displayName,password,systemRole\nli-ming,李明,liveboard123,member\nchen-yan,陈妍,liveboard123,member";

const roleValues = ["super_admin", "admin", "member"] as const;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    if (char !== "\r") {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function parseUserImportCsv(text: string): ParsedImport {
  const csvRows = parseCsv(text.trim());

  if (csvRows.length === 0) {
    return { rows: [], errors: [] };
  }

  const headerRow = csvRows[0] ?? [];
  const bodyRows = csvRows.slice(1);
  const normalizedHeader = headerRow.map((cell) => cell.trim());
  const hasHeader = ["username", "displayName", "password", "systemRole"].every(
    (name) => normalizedHeader.includes(name),
  );
  const rowsToParse = hasHeader ? bodyRows : csvRows;
  const columnIndex = {
    username: hasHeader ? normalizedHeader.indexOf("username") : 0,
    displayName: hasHeader ? normalizedHeader.indexOf("displayName") : 1,
    password: hasHeader ? normalizedHeader.indexOf("password") : 2,
    systemRole: hasHeader ? normalizedHeader.indexOf("systemRole") : 3,
  };
  const parsed: ImportUserDraft[] = [];
  const errors: string[] = [];

  rowsToParse.forEach((row, index) => {
    const rowNumber = hasHeader ? index + 2 : index + 1;
    const username = row[columnIndex.username]?.trim() ?? "";
    const displayName = row[columnIndex.displayName]?.trim() ?? "";
    const password = row[columnIndex.password] ?? "";
    const rawRole = row[columnIndex.systemRole]?.trim() ?? "";

    if (!username && !displayName && !password && !rawRole) {
      return;
    }

    if (!username) {
      errors.push(`第 ${rowNumber} 行缺少登录账号`);
    }

    if (!displayName) {
      errors.push(`第 ${rowNumber} 行缺少显示名`);
    }

    if (password.length < 8) {
      errors.push(`第 ${rowNumber} 行密码少于 8 位`);
    }

    if (!roleValues.includes(rawRole as SystemRole)) {
      errors.push(
        `第 ${rowNumber} 行系统权限应为 super_admin、admin 或 member`,
      );
    }

    if (
      username &&
      displayName &&
      password.length >= 8 &&
      roleValues.includes(rawRole as SystemRole)
    ) {
      parsed.push({
        username,
        displayName,
        password,
        systemRole: rawRole as SystemRole,
      });
    }
  });

  return { rows: parsed, errors };
}

export function UserManagementClient() {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [tags, setTags] = useState<UserTagSummary[]>([]);
  const [actor, setActor] = useState<UserSummary | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [systemRole, setSystemRole] = useState<SystemRole>("member");
  const [csvText, setCsvText] = useState("");
  const [importResult, setImportResult] = useState<ImportUsersResult | null>(
    null,
  );
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<UserEditDraft | null>(null);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [errorNotice, setError] = useFeedbackNotice();
  const [messageNotice, setMessage] = useFeedbackNotice();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | SystemRole>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | UserSummary["status"]
  >("all");
  const [identityFilter, setIdentityFilter] = useState<
    "all" | "linked" | "unlinked" | "attention"
  >("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("local");
  const [authProfileUrl, setAuthProfileUrl] = useState("");
  const [editingIdentity, setEditingIdentity] =
    useState<AdminHfliveIdentityDetail | null>(null);
  const [identitySyncing, setIdentitySyncing] = useState(false);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const parsedImport = useMemo(() => parseUserImportCsv(csvText), [csvText]);
  const editingUser = users.find((user) => user.id === editingUserId) ?? null;
  const actorIsSuperAdmin = actor?.systemRole === "super_admin";
  const hfliveEnabled = authMode !== "local";
  const ssoOnly = authMode === "hflive_oidc";
  const needsIdentityAttention = (user: AdminUserSummary) =>
    user.hflive?.linked &&
    (user.hflive.externalStatus === "DISABLED" ||
      user.hflive.syncState === "ERROR" ||
      user.hflive.syncState === "PROFILE_CONFLICT");
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter(
      (user) =>
        (roleFilter === "all" || user.systemRole === roleFilter) &&
        (statusFilter === "all" || user.status === statusFilter) &&
        (identityFilter === "all" ||
          (identityFilter === "linked" && user.hflive?.linked) ||
          (identityFilter === "unlinked" && !user.hflive?.linked) ||
          (identityFilter === "attention" && needsIdentityAttention(user))) &&
        (tagFilter === "all" ||
          user.tags?.some((tag) => tag.id === tagFilter)) &&
        (!normalizedQuery ||
          user.displayName.toLowerCase().includes(normalizedQuery) ||
          user.username.toLowerCase().includes(normalizedQuery)),
    );
  }, [
    query,
    roleFilter,
    statusFilter,
    identityFilter,
    tagFilter,
    users,
    authMode,
  ]);

  async function loadUsers() {
    const [userResult, tagResult] = await Promise.all([
      listUsers(),
      listUserTags(),
    ]);
    setUsers(userResult.users);
    setTags(tagResult.tags);
  }

  useEffect(() => {
    loadUsers()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载成员失败");
      })
      .finally(() => setLoadingUsers(false));
    getMe()
      .then((result) => setActor(result.user))
      .catch(() => setActor(null));
    getAuthCapabilities()
      .then((result) => {
        setAuthMode(result.mode);
        setAuthProfileUrl(result.profileUrl);
      })
      .catch(() => setAuthMode("local"));
  }, []);

  async function onCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await createUser({
        username,
        displayName,
        password,
        systemRole,
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setSystemRole("member");
      setImportResult(null);
      setShowCreateUserModal(false);
      setMessage("成员已创建");
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建成员失败");
    }
  }

  function onCsvFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ""));
      setImportResult(null);
      setError(null);
      setMessage(null);
      setError(null);
      setMessage(null);
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function onImportUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setImportResult(null);

    if (parsedImport.errors.length > 0) {
      setError("请先修正 CSV 中的格式问题");
      return;
    }

    if (parsedImport.rows.length === 0) {
      setError("没有可导入的成员");
      return;
    }

    try {
      const result = await importUsersApi({ users: parsedImport.rows });
      setImportResult(result.result);
      setMessage(`批量导入完成，已创建 ${result.result.created.length} 个成员`);
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入成员失败");
    }
  }

  function startEdit(user: AdminUserSummary) {
    setError(null);
    setMessage(null);
    setEditingUserId(user.id);
    setEditDraft({
      username: user.username,
      displayName: user.displayName,
      systemRole: user.systemRole,
      status: user.status,
      password: "",
      aiCallLimit: user.aiCallLimit === null ? "" : String(user.aiCallLimit),
      tagIds: user.tags?.map((tag) => tag.id) ?? [],
    });
    setEditingIdentity(null);
    setIdentityLoaded(false);
    if (hfliveEnabled && user.hflive?.linked) {
      getAdminHfliveIdentity(user.id)
        .then((result) => {
          setEditingIdentity(result.identity);
        })
        .catch(() => setEditingIdentity(null))
        .finally(() => setIdentityLoaded(true));
    } else {
      setIdentityLoaded(true);
    }
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditDraft(null);
    setEditingIdentity(null);
  }

  async function onSyncIdentity(userId: string) {
    if (identitySyncing) return;
    setIdentitySyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await hfliveSyncUser(userId);
      setEditingIdentity(result.identity);
      setMessage("统一身份资料已同步");
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "同步统一身份失败");
    } finally {
      setIdentitySyncing(false);
    }
  }

  async function onUpdateUser(userId: string) {
    if (!editDraft) {
      return;
    }

    setError(null);
    setMessage(null);

    const trimmedAiCallLimit = editDraft.aiCallLimit.trim();
    let aiCallLimit: number | null | undefined;

    if (trimmedAiCallLimit !== "") {
      const parsed = Number(trimmedAiCallLimit);

      if (!Number.isInteger(parsed) || parsed < 0) {
        setError("每日 AI 调用限额需为不小于 0 的整数");
        return;
      }

      aiCallLimit = parsed;
    } else {
      aiCallLimit = null;
    }

    const currentAiCallLimit = editingUser?.aiCallLimit ?? null;
    const linked = Boolean(editingUser?.hflive?.linked);

    try {
      await updateUser(userId, {
        // 已绑定用户显示名/密码由 HFLive Auth 权威管理，服务端会拒绝；
        // 前端直接不提交这些字段（双保险）。
        ...(!linked ? { displayName: editDraft.displayName } : {}),
        ...(actorIsSuperAdmin && editDraft.username !== editingUser?.username
          ? { username: editDraft.username }
          : {}),
        systemRole: editDraft.systemRole,
        status: editDraft.status,
        ...(!linked && editDraft.password
          ? { password: editDraft.password }
          : {}),
        ...(aiCallLimit !== currentAiCallLimit ? { aiCallLimit } : {}),
      });
      await setUserTags(userId, editDraft.tagIds);
      setMessage("成员信息已更新");
      cancelEdit();
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新成员失败");
    }
  }

  async function onCreateTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTagName.trim()) return;
    setError(null);
    setMessage(null);
    try {
      await createUserTag(newTagName);
      setNewTagName("");
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建标签失败");
    }
  }

  async function onRenameTag(tag: UserTagSummary) {
    const name = window.prompt("输入新的标签名称", tag.name)?.trim();
    if (!name || name === tag.name) return;
    try {
      await updateUserTag(tag.id, name);
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重命名标签失败");
    }
  }

  async function onDeleteTag(tag: UserTagSummary) {
    if (!window.confirm(`删除标签“${tag.name}”？成员账号不会被删除。`)) return;
    try {
      await deleteUserTag(tag.id);
      if (tagFilter === tag.id) setTagFilter("all");
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除标签失败");
    }
  }

  function toggleSelectedUser(userId: string) {
    setSelectedUserIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function batchSetStatus(status: UserSummary["status"]) {
    const targets = users.filter(
      (user) =>
        selectedUserIds.has(user.id) &&
        user.id !== actor?.id &&
        (actorIsSuperAdmin || user.systemRole === "member"),
    );
    if (!targets.length) {
      setError("所选成员中没有可批量修改的账号");
      return;
    }

    setBatchUpdating(true);
    setError(null);
    setMessage(null);
    try {
      const { result } = await bulkUpdateUserStatus(
        targets.map((user) => user.id),
        status,
      );
      setMessage(
        `已${status === "active" ? "启用" : "停用"} ${result.updated} 位成员${
          result.skipped > 0 ? `，跳过 ${result.skipped} 位` : ""
        }`,
      );
      setSelectedUserIds(new Set());
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量更新成员失败");
    } finally {
      setBatchUpdating(false);
    }
  }

  return (
    <div className="workspace admin-workspace admin-page admin-page--wide admin-users-page">
      <AdminPageHeader
        category="人员与权限"
        description="管理账号、角色和标签。"
        title="成员管理"
      />

      <FeedbackNotice notice={errorNotice} tone="error" />
      <FeedbackNotice notice={messageNotice} tone="success" />

      <section className="workbench admin-users-layout">
        <div className="workbench-main">
          <div className="panel-head">
            <div>
              <h2 className="admin-list-heading">
                成员列表
                <span className="admin-list-count">
                  {filteredUsers.length === users.length
                    ? loadingUsers
                      ? "正在加载"
                      : `${users.length} 人`
                    : `${filteredUsers.length} / ${users.length} 人`}
                </span>
              </h2>
            </div>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setShowTagModal(true)}
                type="button"
              >
                <Tags aria-hidden="true" className="button-icon" />
                标签管理
              </button>
              {!ssoOnly ? (
                <>
                  <button
                    className="button secondary"
                    onClick={() => setShowImportModal(true)}
                    type="button"
                  >
                    <FileUp aria-hidden="true" className="button-icon" />
                    批量导入
                  </button>
                  <button
                    className="button"
                    onClick={() => setShowCreateUserModal(true)}
                    type="button"
                  >
                    <Plus aria-hidden="true" className="button-icon" />
                    创建成员
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="admin-user-filters">
            <label className="search-field">
              <Search aria-hidden="true" />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索姓名或账号"
                value={query}
              />
            </label>
            <select
              aria-label="按标签筛选"
              className="select compact-select"
              onChange={(event) => setTagFilter(event.target.value)}
              value={tagFilter}
            >
              <option value="all">全部标签</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
            <select
              aria-label="按角色筛选"
              className="select compact-select"
              onChange={(event) =>
                setRoleFilter(event.target.value as "all" | SystemRole)
              }
              value={roleFilter}
            >
              <option value="all">全部角色</option>
              <option value="super_admin">最高管理员</option>
              <option value="admin">管理员</option>
              <option value="member">成员</option>
            </select>
            <select
              aria-label="按状态筛选"
              className="select compact-select"
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as "all" | UserSummary["status"],
                )
              }
              value={statusFilter}
            >
              <option value="all">全部状态</option>
              <option value="active">正常</option>
              <option value="disabled">已停用</option>
            </select>
            {hfliveEnabled ? (
              <select
                aria-label="按统一身份筛选"
                className="select compact-select"
                onChange={(event) =>
                  setIdentityFilter(
                    event.target.value as
                      "all" | "linked" | "unlinked" | "attention",
                  )
                }
                value={identityFilter}
              >
                <option value="all">全部身份</option>
                <option value="linked">已绑定</option>
                <option value="unlinked">未绑定</option>
                <option value="attention">需处理</option>
              </select>
            ) : null}
          </div>
          {selectedUserIds.size > 0 ? (
            <div className="admin-user-batch-bar">
              <span>已选择 {selectedUserIds.size} 位成员</span>
              <button
                className="button secondary"
                disabled={batchUpdating}
                onClick={() => void batchSetStatus("active")}
                type="button"
              >
                批量启用
              </button>
              <button
                className="button danger"
                disabled={batchUpdating}
                onClick={() => void batchSetStatus("disabled")}
                type="button"
              >
                批量停用
              </button>
              <button
                className="button secondary"
                onClick={() => setSelectedUserIds(new Set())}
                type="button"
              >
                取消选择
              </button>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th aria-label="选择成员" />
                  <th>显示名</th>
                  <th>登录账号</th>
                  <th>标签</th>
                  <th>角色</th>
                  <th>状态</th>
                  {hfliveEnabled ? <th>统一身份</th> : null}
                  <th>今日 AI</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loadingUsers ? (
                  <TableSkeletonRows
                    colSpan={hfliveEnabled ? 9 : 8}
                    count={6}
                  />
                ) : null}
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td data-label="选择">
                      <input
                        aria-label={`选择 ${user.displayName}`}
                        checked={selectedUserIds.has(user.id)}
                        disabled={user.id === actor?.id}
                        onChange={() => toggleSelectedUser(user.id)}
                        type="checkbox"
                      />
                    </td>
                    <td data-label="显示名">
                      <UserProfileLink
                        className="user-profile-link"
                        compactBadges
                        user={user}
                      />
                    </td>
                    <td data-label="登录账号">
                      <span className="account-code">{user.username}</span>
                    </td>
                    <td data-label="标签">
                      <div className="user-tag-list">
                        {user.tags?.length ? (
                          user.tags.map((tag) => (
                            <span className="user-tag" key={tag.id}>
                              {tag.name}
                            </span>
                          ))
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </div>
                    </td>
                    <td data-label="角色">{roleLabel(user.systemRole)}</td>
                    <td data-label="状态">
                      {user.status === "disabled" &&
                      user.hflive?.externalStatus === "DISABLED"
                        ? "已停用（统一身份）"
                        : userStatusLabel(user.status)}
                    </td>
                    {hfliveEnabled ? (
                      <td data-label="统一身份">
                        <IdentityStateBadge user={user} />
                      </td>
                    ) : null}
                    <td data-label="今日 AI">
                      {user.aiCallCount} 次
                      <span className="muted">
                        {" "}
                        /{" "}
                        {user.aiCallLimit === null ? "默认" : user.aiCallLimit}
                      </span>
                    </td>
                    <td data-label="操作">
                      {actorIsSuperAdmin || user.systemRole === "member" ? (
                        <button
                          className="inline-icon-button"
                          onClick={() => startEdit(user)}
                          title="编辑成员"
                          type="button"
                        >
                          <Pencil aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loadingUsers && filteredUsers.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={hfliveEnabled ? 9 : 8}>
                      {users.length ? "没有匹配的成员" : "暂无成员"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {showCreateUserModal ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-panel" onSubmit={onCreateUser}>
            <div className="modal-head">
              <h2>创建成员</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowCreateUserModal(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <label className="label">
                登录账号
                <input
                  autoFocus
                  className="input"
                  placeholder="用于登录，例如 zhang-san"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className="label">
                显示名
                <input
                  className="input"
                  placeholder="界面展示，例如 张三"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="label">
                初始密码
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="label">
                角色
                <select
                  className="select"
                  value={systemRole}
                  onChange={(event) =>
                    setSystemRole(event.target.value as SystemRole)
                  }
                >
                  <option value="member">普通成员</option>
                  {actorIsSuperAdmin ? (
                    <>
                      <option value="admin">管理员</option>
                      <option value="super_admin">最高管理员</option>
                    </>
                  ) : null}
                </select>
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setShowCreateUserModal(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="button" type="submit">
                  创建成员
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {showImportModal ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-panel" onSubmit={onImportUsers}>
            <div className="modal-head">
              <div>
                <h2>批量导入</h2>
                <p className="muted">从 CSV 创建成员</p>
              </div>
              <button
                className="icon-button subtle"
                onClick={() => setShowImportModal(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body import-form">
              <label className="label">
                CSV 文件
                <input
                  className="input"
                  accept=".csv,text/csv"
                  type="file"
                  onChange={onCsvFileSelected}
                />
              </label>
              <label className="label">
                CSV 内容
                <AutoTextarea
                  className="textarea mono-textarea"
                  placeholder="username,displayName,password,systemRole"
                  rows={8}
                  value={csvText}
                  onChange={(event) => {
                    setCsvText(event.target.value);
                    setImportResult(null);
                  }}
                />
              </label>
              <div className="button-row left">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setCsvText(csvExample)}
                >
                  填入示例
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setCsvText("");
                    setImportResult(null);
                  }}
                >
                  清空
                </button>
              </div>
              <div className="import-preview">
                <strong>预览：{parsedImport.rows.length} 个可导入成员</strong>
                <span>登录账号、显示名、初始密码、角色</span>
                {parsedImport.errors.length > 0 ? (
                  <ul>
                    {parsedImport.errors.slice(0, 4).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                    {parsedImport.errors.length > 4 ? (
                      <li>还有 {parsedImport.errors.length - 4} 个问题</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
              {importResult ? (
                <div className="import-result">
                  <span>创建 {importResult.created.length}</span>
                  <span>跳过 {importResult.skipped.length}</span>
                  <span>失败 {importResult.failed.length}</span>
                </div>
              ) : null}
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setShowImportModal(false)}
                  type="button"
                >
                  {importResult ? "完成" : "取消"}
                </button>
                <button
                  className="button"
                  disabled={
                    Boolean(importResult) ||
                    parsedImport.rows.length === 0 ||
                    parsedImport.errors.length > 0
                  }
                  type="submit"
                >
                  {importResult ? "导入完成" : "导入成员"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {editingUser && editDraft ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void onUpdateUser(editingUser.id);
            }}
          >
            <div className="modal-head">
              <h2>编辑成员</h2>
              <button
                className="icon-button subtle"
                onClick={cancelEdit}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              {hfliveEnabled && editingUser.hflive?.linked ? (
                <section className="identity-owner-panel">
                  <h3>
                    <ShieldCheck aria-hidden="true" className="heading-icon" />
                    统一身份
                  </h3>
                  <p className="muted">
                    HFLive Auth 是权威来源，以下字段不在此修改。
                  </p>
                  <div className="profile-readonly-grid">
                    <div>
                      <span>统一账号</span>
                      <strong>
                        {editingIdentity?.preferredUsername ?? "…"}
                      </strong>
                    </div>
                    <div>
                      <span>统一邮箱</span>
                      <strong>{editingIdentity?.email ?? "-"}</strong>
                    </div>
                    <div>
                      <span>统一显示名</span>
                      <strong>{editingIdentity?.displayName ?? "…"}</strong>
                    </div>
                  </div>
                  {identityLoaded && editingIdentity ? (
                    <div className="identity-owner-meta">
                      <span>
                        绑定方式：
                        {hfliveLinkMethodLabel(editingIdentity.linkMethod)}
                      </span>
                      <span>
                        最近同步：
                        {editingIdentity.lastProfileSyncedAt
                          ? new Date(
                              editingIdentity.lastProfileSyncedAt,
                            ).toLocaleString("zh-CN", { hour12: false })
                          : "从未"}
                      </span>
                      <span className="identity-state-line">
                        同步状态：
                        {hfliveSyncStateLabel(editingIdentity.syncState)}
                      </span>
                      {editingIdentity.syncState === "PROFILE_CONFLICT" ? (
                        <p className="identity-state-explain">
                          统一用户名或邮箱与另一本地账号冲突，暂保留本地值。
                          最高管理员可给占用账号改名后重新同步解决。
                        </p>
                      ) : null}
                      {editingIdentity.syncState === "ERROR" ? (
                        <p className="identity-state-explain">
                          最近一次同步失败，资料可能已过期。可点「立即同步」重试。
                        </p>
                      ) : null}
                      {editingIdentity.externalStatus === "DISABLED" ? (
                        <p className="identity-state-explain">
                          该账号已在 HFLive Auth
                          停用，其下一次认证请求会被拒绝。
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={identitySyncing}
                      onClick={() => void onSyncIdentity(editingUser.id)}
                      type="button"
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={identitySyncing ? "spin" : "button-icon"}
                      />
                      {identitySyncing ? "正在同步…" : "立即同步"}
                    </button>
                    {authProfileUrl ? (
                      <a
                        className="button secondary"
                        href={authProfileUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink
                          aria-hidden="true"
                          className="button-icon"
                        />
                        前往 HFLive Auth 修改
                      </a>
                    ) : null}
                  </div>
                </section>
              ) : null}
              <section className="identity-owner-panel">
                <h3>本地管理</h3>
                {hfliveEnabled && !editingUser.hflive?.linked ? (
                  <p className="muted">
                    该用户尚未绑定统一身份，绑定需用户在登录时自助完成。
                  </p>
                ) : null}
                <label className="label">
                  登录账号
                  {actorIsSuperAdmin ? (
                    <>
                      <input
                        className="input"
                        value={editDraft.username}
                        onChange={(event) =>
                          setEditDraft({
                            ...editDraft,
                            username: event.target.value,
                          })
                        }
                      />
                      <small className="field-hint">
                        仅最高管理员可改。若该用户已绑定 HFLive，下次同步会被
                        统一用户名覆盖（用于解决用户名冲突）。
                      </small>
                    </>
                  ) : (
                    <strong className="readonly-value">
                      {editingUser.username}
                    </strong>
                  )}
                </label>
                {!editingUser.hflive?.linked ? (
                  <label className="label">
                    显示名
                    <input
                      className="input"
                      value={editDraft.displayName}
                      onChange={(event) =>
                        setEditDraft({
                          ...editDraft,
                          displayName: event.target.value,
                        })
                      }
                    />
                  </label>
                ) : null}
                <div className="form-grid two">
                  <label className="label">
                    角色
                    <select
                      className="select"
                      value={editDraft.systemRole}
                      onChange={(event) =>
                        setEditDraft({
                          ...editDraft,
                          systemRole: event.target.value as SystemRole,
                        })
                      }
                    >
                      <option value="member">普通成员</option>
                      {actorIsSuperAdmin ? (
                        <>
                          <option value="admin">管理员</option>
                          <option value="super_admin">最高管理员</option>
                        </>
                      ) : null}
                    </select>
                  </label>
                  <label className="label">
                    状态
                    <select
                      className="select"
                      value={editDraft.status}
                      onChange={(event) =>
                        setEditDraft({
                          ...editDraft,
                          status: event.target.value as UserSummary["status"],
                        })
                      }
                    >
                      <option value="active">正常</option>
                      <option value="disabled">已停用</option>
                    </select>
                  </label>
                </div>
                {editingUser.systemRole === "super_admin" ? (
                  <p className="muted">
                    系统必须始终保留至少一位正常状态的最高管理员。
                  </p>
                ) : null}
                {!editingUser.hflive?.linked ? (
                  <label className="label">
                    重置密码
                    <input
                      className="input"
                      type="password"
                      placeholder="不修改密码可留空"
                      value={editDraft.password}
                      onChange={(event) =>
                        setEditDraft({
                          ...editDraft,
                          password: event.target.value,
                        })
                      }
                    />
                  </label>
                ) : null}
                <label className="label">
                  每日 AI 调用限额
                  <input
                    className="input"
                    min={0}
                    placeholder="留空则跟随默认限额"
                    type="number"
                    value={editDraft.aiCallLimit}
                    onChange={(event) =>
                      setEditDraft({
                        ...editDraft,
                        aiCallLimit: event.target.value,
                      })
                    }
                  />
                  <small className="field-hint">
                    今日已用 {editingUser.aiCallCount} 次；留空使用默认限额。
                  </small>
                </label>
                <fieldset className="tag-choice-field">
                  <legend>成员标签</legend>
                  <div className="tag-choice-grid">
                    {tags.map((tag) => (
                      <label key={tag.id}>
                        <input
                          checked={editDraft.tagIds.includes(tag.id)}
                          onChange={() =>
                            setEditDraft({
                              ...editDraft,
                              tagIds: editDraft.tagIds.includes(tag.id)
                                ? editDraft.tagIds.filter((id) => id !== tag.id)
                                : [...editDraft.tagIds, tag.id],
                            })
                          }
                          type="checkbox"
                        />
                        <span>{tag.name}</span>
                      </label>
                    ))}
                    {tags.length === 0 ? (
                      <span className="muted">暂无标签</span>
                    ) : null}
                  </div>
                </fieldset>
              </section>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={cancelEdit}
                  type="button"
                >
                  取消
                </button>
                <button className="button" type="submit">
                  保存修改
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {showTagModal ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h2>标签管理</h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowTagModal(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <form className="tag-create-row" onSubmit={onCreateTag}>
                <input
                  autoFocus
                  className="input"
                  maxLength={32}
                  onChange={(event) => setNewTagName(event.target.value)}
                  placeholder="新标签名称"
                  value={newTagName}
                />
                <button className="button" type="submit">
                  创建标签
                </button>
              </form>
              <div className="tag-manager-list">
                {tags.map((tag) => (
                  <div key={tag.id}>
                    <span>
                      <strong>{tag.name}</strong>
                      <small>{tag.memberCount ?? 0} 人</small>
                    </span>
                    <div className="button-row">
                      <button
                        className="inline-icon-button"
                        onClick={() => void onRenameTag(tag)}
                        title="重命名标签"
                        type="button"
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                      <button
                        className="inline-icon-button danger"
                        onClick={() => void onDeleteTag(tag)}
                        title="删除标签"
                        type="button"
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
                {tags.length === 0 ? <p className="muted">暂无标签。</p> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function IdentityStateBadge({ user }: { user: AdminUserSummary }) {
  const identity = user.hflive;
  if (!identity?.linked) {
    return <span className="muted identity-state-text">未绑定</span>;
  }
  let text = "正常";
  let tone: "attention" | "danger" | "ok" = "ok";
  if (identity.externalStatus === "DISABLED") {
    text = "外部停用";
    tone = "danger";
  } else if (identity.syncState === "PROFILE_CONFLICT") {
    text = "同步冲突";
    tone = "attention";
  } else if (identity.syncState === "ERROR") {
    text = "同步异常";
    tone = "attention";
  }
  const syncedAt = identity.lastProfileSyncedAt
    ? new Date(identity.lastProfileSyncedAt).toLocaleString("zh-CN", {
        hour12: false,
      })
    : "从未";
  return (
    <span
      className={`identity-state-badge ${tone}`}
      title={`绑定方式：${hfliveLinkMethodLabel(identity.linkMethod)}；最近同步：${syncedAt}`}
    >
      {text}
    </span>
  );
}
