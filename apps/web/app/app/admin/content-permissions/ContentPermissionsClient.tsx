"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PermissionGroupSummary,
  PermissionLevel,
} from "@liveboard/shared";
import { AdminSubnav } from "@/components/admin/AdminSubnav";
import {
  deletePermissionGrant,
  getDefaultPermissionWorkspace,
  listPermissionGroups,
  listPermissionGrants,
  PermissionGrantSummary,
  upsertPermissionGrant,
} from "@/lib/api";

type WorkspaceSummary = { id: string; name: string };
type WorkspacePermission = PermissionLevel | "";

const permissionOptions: Array<{
  value: Exclude<PermissionLevel, "no_access">;
  label: string;
}> = [
  { value: "viewer", label: "可查看" },
  { value: "lecturer", label: "可制作课件" },
  { value: "editor", label: "可编辑" },
  { value: "owner", label: "可管理" },
];

export function ContentPermissionsClient() {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [groups, setGroups] = useState<PermissionGroupSummary[]>([]);
  const [grants, setGrants] = useState<PermissionGrantSummary[]>([]);
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedGroupAt, setSavedGroupAt] = useState<Record<string, Date>>({});
  const grantByGroupId = useMemo(
    () =>
      new Map(
        grants
          .filter((grant) => grant.groupId)
          .map((grant) => [grant.groupId, grant] as const),
      ),
    [grants],
  );

  async function load() {
    const workspaceResult = await getDefaultPermissionWorkspace();
    const [groupResult, grantResult] = await Promise.all([
      listPermissionGroups(),
      listPermissionGrants("workspace", workspaceResult.workspace.id),
    ]);

    setWorkspace(workspaceResult.workspace);
    setGroups(groupResult.groups);
    setGrants(grantResult.grants);
  }

  useEffect(() => {
    load().catch((caught) => {
      setError(
        caught instanceof Error ? caught.message : "加载文档默认权限失败",
      );
    });
  }, []);

  async function updateWorkspacePermission(
    group: PermissionGroupSummary,
    level: WorkspacePermission,
  ) {
    if (!workspace) return;

    setSavingGroupId(group.id);
    setError(null);
    setMessage(null);

    try {
      const currentGrant = grantByGroupId.get(group.id);

      if (!level) {
        if (currentGrant) {
          await deletePermissionGrant(currentGrant.id);
        }
      } else {
        await upsertPermissionGrant({
          targetType: "workspace",
          targetId: workspace.id,
          groupId: group.id,
          level,
        });
      }

      const grantResult = await listPermissionGrants("workspace", workspace.id);
      setGrants(grantResult.grants);
      setMessage(
        level
          ? `「${group.name}」的文档默认权限已更新`
          : `「${group.name}」不再获得默认文档权限`,
      );
      setSavedGroupAt((current) => ({ ...current, [group.id]: new Date() }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存默认权限失败");
    } finally {
      setSavingGroupId(null);
    }
  }

  return (
    <div className="workspace admin-workspace content-permissions-workspace">
      <header className="page-head">
        <div>
          <h1>文档权限</h1>
          <p className="muted">设置所有顶层文件夹默认继承的权限。</p>
        </div>
      </header>

      <AdminSubnav />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="content-permission-overview">
        <h2>{workspace?.name ?? "文档默认权限"}</h2>
        <p>
          这里设置 workspace
          的基础权限。顶层文件夹、子文件夹和文件会逐级继承；某一级单独设置的例外权限优先生效。
        </p>
        <p>系统管理员始终可以管理全部文档，不受下方设置影响。</p>
      </section>

      <section className="content-permission-panel">
        <div className="panel-head content-permission-head">
          <div>
            <h2>权限组默认权限</h2>
            <p>没有默认权限的组，只能通过具体文件夹或文件获得访问权限。</p>
          </div>
          <span>{groups.length} 个权限组</span>
        </div>

        <div className="content-permission-list">
          {groups.map((group) => {
            const grant = grantByGroupId.get(group.id);
            const value = grant?.level ?? "";

            return (
              <div className="content-permission-row" key={group.id}>
                <div>
                  <strong>{group.name}</strong>
                  <span>
                    {group.memberCount} 人
                    {group.description ? ` · ${group.description}` : ""}
                  </span>
                </div>
                <label>
                  <select
                    aria-label={`${group.name}的默认权限`}
                    className="select"
                    disabled={!workspace || savingGroupId === group.id}
                    value={value}
                    onChange={(event) =>
                      void updateWorkspacePermission(
                        group,
                        event.target.value as WorkspacePermission,
                      )
                    }
                  >
                    <option value="">无默认权限</option>
                    {permissionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    {value === "no_access" ? (
                      <option value="no_access">禁止访问（旧设置）</option>
                    ) : null}
                  </select>
                  <small
                    className="content-permission-save-state"
                    aria-live="polite"
                  >
                    {savingGroupId === group.id
                      ? "保存中"
                      : savedGroupAt[group.id]
                        ? `已保存 ${savedGroupAt[group.id]?.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                        : "更改后自动保存"}
                  </small>
                </label>
              </div>
            );
          })}

          {groups.length === 0 ? (
            <div className="empty-panel compact">
              <strong>还没有权限组</strong>
              <span>请先在“权限组”中创建分组并添加成员。</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
