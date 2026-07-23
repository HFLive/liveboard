"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AdminUserSummary,
  SystemRole,
  UserSummary,
} from "@liveboard/shared";
import { FileUp, Pencil, Plus, Search, X } from "lucide-react";
import {
  createUser,
  getMe,
  importUsers as importUsersApi,
  type ImportUsersResult,
  listUsers,
  updateUser,
} from "@/lib/api";
import { roleLabel, userStatusLabel } from "@/lib/labels";
import { UserProfileLink } from "@/components/UserProfileLink";
import { AutoTextarea } from "@/components/AutoTextarea";
import { TableSkeletonRows } from "@/components/system/ProgressiveLoading";

type UserEditDraft = {
  displayName: string;
  systemRole: SystemRole;
  status: UserSummary["status"];
  password: string;
  aiCallLimit: string;
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | SystemRole>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | UserSummary["status"]
  >("all");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const parsedImport = useMemo(() => parseUserImportCsv(csvText), [csvText]);
  const editingUser = users.find((user) => user.id === editingUserId) ?? null;
  const actorIsSuperAdmin = actor?.systemRole === "super_admin";
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter(
      (user) =>
        (roleFilter === "all" || user.systemRole === roleFilter) &&
        (statusFilter === "all" || user.status === statusFilter) &&
        (!normalizedQuery ||
          user.displayName.toLowerCase().includes(normalizedQuery) ||
          user.username.toLowerCase().includes(normalizedQuery)),
    );
  }, [query, roleFilter, statusFilter, users]);

  async function loadUsers() {
    const result = await listUsers();
    setUsers(result.users);
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
      displayName: user.displayName,
      systemRole: user.systemRole,
      status: user.status,
      password: "",
      aiCallLimit: user.aiCallLimit === null ? "" : String(user.aiCallLimit),
    });
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditDraft(null);
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

    try {
      await updateUser(userId, {
        displayName: editDraft.displayName,
        systemRole: editDraft.systemRole,
        status: editDraft.status,
        password: editDraft.password || undefined,
        ...(aiCallLimit !== currentAiCallLimit ? { aiCallLimit } : {}),
      });
      setMessage("成员信息已更新");
      cancelEdit();
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新成员失败");
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
    try {
      await Promise.all(
        targets.map((user) =>
          updateUser(user.id, {
            displayName: user.displayName,
            systemRole: user.systemRole,
            status,
          }),
        ),
      );
      setMessage(
        `已${status === "active" ? "启用" : "停用"} ${targets.length} 位成员`,
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
    <div className="workspace admin-workspace admin-users-page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">管理中心</p>
          <h1>成员管理</h1>
          <p className="muted">创建、导入并维护平台成员的账号与权限。</p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

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
            </div>
          </div>
          <div className="admin-user-filters">
            <label className="search-field">
              <Search aria-hidden="true" />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索显示名或登录账号"
                value={query}
              />
            </label>
            <select
              aria-label="按系统权限筛选"
              className="select compact-select"
              onChange={(event) =>
                setRoleFilter(event.target.value as "all" | SystemRole)
              }
              value={roleFilter}
            >
              <option value="all">全部权限</option>
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
                  <th>系统权限</th>
                  <th>状态</th>
                  <th>今日 AI 调用</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loadingUsers ? (
                  <TableSkeletonRows colSpan={7} count={6} />
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
                        user={user}
                      />
                    </td>
                    <td data-label="登录账号">
                      <span className="account-code">{user.username}</span>
                    </td>
                    <td data-label="系统权限">{roleLabel(user.systemRole)}</td>
                    <td data-label="状态">{userStatusLabel(user.status)}</td>
                    <td data-label="今日 AI 调用">
                      今日 {user.aiCallCount} 次
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
                    <td className="empty-cell" colSpan={7}>
                      {users.length
                        ? "没有符合当前筛选条件的成员。"
                        : "暂无成员。"}
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
                系统权限
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
                <p className="muted">CSV 创建多个成员</p>
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
                <span>字段：登录账号、显示名、初始密码、系统权限</span>
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
              <div className="profile-readonly-grid">
                <div>
                  <span>登录账号</span>
                  <strong>{editingUser.username}</strong>
                </div>
                <div>
                  <span>当前系统权限</span>
                  <strong>{roleLabel(editingUser.systemRole)}</strong>
                </div>
                <div>
                  <span>当前状态</span>
                  <strong>{userStatusLabel(editingUser.status)}</strong>
                </div>
              </div>
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
              <div className="form-grid two">
                <label className="label">
                  系统权限
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
                  今日已使用 {editingUser.aiCallCount}{" "}
                  次；留空则跟随每日默认限额。
                </small>
              </label>
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
    </div>
  );
}
