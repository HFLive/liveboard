"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  PermissionLevel,
  UserSummary,
  UserTagSummary,
} from "@liveboard/shared";
import {
  deletePermissionGrant,
  getDefaultPermissionWorkspace,
  listAssignablePermissionUsers,
  listPermissionGrants,
  type PermissionGrantSummary,
  upsertPermissionGrant,
} from "@/lib/api";
import { permissionLabel } from "@/lib/labels";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

const permissionOptions: Array<{
  value: PermissionLevel;
  label: string;
}> = [
  { value: "viewer", label: "可查看" },
  { value: "lecturer", label: "可制作课件" },
  { value: "editor", label: "可编辑" },
  { value: "owner", label: "可管理" },
  { value: "no_access", label: "禁止访问" },
];

export function ContentPermissionsClient() {
  useDocumentTitle("文档权限");
  const [workspace, setWorkspace] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [tags, setTags] = useState<UserTagSummary[]>([]);
  const [grants, setGrants] = useState<PermissionGrantSummary[]>([]);
  const [query, setQuery] = useState("");
  const [tagId, setTagId] = useState("all");
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const grantByUserId = useMemo(
    () => new Map(grants.map((grant) => [grant.userId, grant])),
    [grants],
  );
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return users.filter(
      (user) =>
        (tagId === "all" || user.tags?.some((tag) => tag.id === tagId)) &&
        (!normalizedQuery ||
          `${user.displayName} ${user.username}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)),
    );
  }, [query, tagId, users]);

  async function load() {
    const workspaceResult = await getDefaultPermissionWorkspace();
    const [grantResult, userResult] = await Promise.all([
      listPermissionGrants("workspace", workspaceResult.workspace.id),
      listAssignablePermissionUsers({
        targetType: "workspace",
        targetId: workspaceResult.workspace.id,
      }),
    ]);
    setWorkspace(workspaceResult.workspace);
    setGrants(grantResult.grants);
    setUsers(userResult.users);
    setTags(userResult.tags);
  }

  useEffect(() => {
    load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载文档权限失败");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updatePermission(
    user: UserSummary,
    level: PermissionLevel | "",
  ) {
    if (!workspace) return;
    setSavingUserId(user.id);
    setError(null);
    setMessage(null);
    try {
      const current = grantByUserId.get(user.id);
      if (!level) {
        if (current) await deletePermissionGrant(current.id);
      } else {
        await upsertPermissionGrant({
          targetType: "workspace",
          targetId: workspace.id,
          userId: user.id,
          level,
        });
      }
      const result = await listPermissionGrants("workspace", workspace.id);
      setGrants(result.grants);
      setMessage(`已更新 ${user.displayName} 的文档权限`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存权限失败");
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <div className="workspace admin-workspace admin-page admin-page--focused content-permissions-workspace">
      <AdminPageHeader
        category="人员与权限"
        description="设置成员对文档空间的默认权限。"
        title="文档权限"
      />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="content-permission-panel">
        <div className="panel-head content-permission-head">
          <div>
            <h2>{workspace?.name ?? "文档默认权限"}</h2>
            <p>文件夹和文档会继承此处设置，也可单独覆盖。</p>
          </div>
          <span>{grants.length} 项例外</span>
        </div>
        <div className="content-permission-filters">
          <label>
            <Search aria-hidden="true" />
            <input
              className="input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索姓名或用户名"
              value={query}
            />
          </label>
          <select
            aria-label="按成员标签筛选"
            className="select"
            onChange={(event) => setTagId(event.target.value)}
            value={tagId}
          >
            <option value="all">全部标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>
        <div className="content-permission-list">
          {filteredUsers.map((user) => {
            const grant = grantByUserId.get(user.id);
            return (
              <div className="content-permission-row" key={user.id}>
                <div>
                  <strong>{user.displayName}</strong>
                  <span>
                    @{user.username}
                    {user.tags?.length
                      ? ` · ${user.tags.map((tag) => tag.name).join(" · ")}`
                      : ""}
                  </span>
                </div>
                <label>
                  <select
                    aria-label={`${user.displayName}的文档权限`}
                    className="select"
                    disabled={savingUserId === user.id}
                    onChange={(event) =>
                      void updatePermission(
                        user,
                        event.target.value as PermissionLevel | "",
                      )
                    }
                    value={grant?.level ?? ""}
                  >
                    <option value="">使用默认（可查看）</option>
                    {permissionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small>
                    {savingUserId === user.id
                      ? "保存中…"
                      : grant
                        ? `例外：${permissionLabel(grant.level)}`
                        : "跟随成员默认权限"}
                  </small>
                </label>
              </div>
            );
          })}
          {filteredUsers.length === 0 ? (
            <div className="empty-panel compact">
              <strong>没有匹配的成员</strong>
              <span>请调整搜索或筛选条件。</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
