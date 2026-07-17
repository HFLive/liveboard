"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { PermissionGroupSummary, UserSummary } from "@liveboard/shared";
import {
  Check,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  addPermissionGroupMember,
  createPermissionGroup,
  deletePermissionGroup,
  listPermissionGroups,
  listUsers,
  removePermissionGroupMember,
  updatePermissionGroup,
} from "@/lib/api";
import { userStatusLabel } from "@/lib/labels";
import { UserProfileLink } from "@/components/UserProfileLink";
import { AdminSubnav } from "@/components/admin/AdminSubnav";

export function PermissionGroupsClient() {
  const [groups, setGroups] = useState<PermissionGroupSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const selectedMembers = selectedGroup?.members ?? [];
  const groupMemberUserIds = useMemo(
    () =>
      new Set(selectedGroup?.members?.map((member) => member.user.id) ?? []),
    [selectedGroup],
  );
  const filteredGroups = useMemo(() => {
    const query = groupQuery.trim().toLowerCase();

    if (!query) {
      return groups;
    }

    return groups.filter((group) =>
      [group.name, group.description ?? ""].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [groupQuery, groups]);
  const availableUsers = useMemo(
    () =>
      users.filter(
        (user) => user.status === "active" && !groupMemberUserIds.has(user.id),
      ),
    [groupMemberUserIds, users],
  );
  const filteredMembers = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    if (!query) return selectedMembers;
    return selectedMembers.filter((member) =>
      [member.user.displayName, member.user.username].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [memberQuery, selectedMembers]);
  const filteredCandidates = useMemo(() => {
    const query = candidateQuery.trim().toLowerCase();
    if (!query) return availableUsers;
    return availableUsers.filter((user) =>
      [user.displayName, user.username].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [availableUsers, candidateQuery]);

  async function load() {
    const [groupResult, userResult] = await Promise.all([
      listPermissionGroups(),
      listUsers(),
    ]);
    setGroups(groupResult.groups);
    setUsers(userResult.users);
    setSelectedGroupId((current) =>
      groupResult.groups.some((group) => group.id === current)
        ? current
        : (groupResult.groups[0]?.id ?? ""),
    );
  }

  useEffect(() => {
    load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载权限组失败");
    });
  }, []);

  useEffect(() => {
    if (!selectedGroup) {
      setEditName("");
      setEditDescription("");
      return;
    }

    setEditName(selectedGroup.name);
    setEditDescription(selectedGroup.description ?? "");
  }, [selectedGroup]);

  async function onCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      const result = await createPermissionGroup({ name, description });
      setName("");
      setDescription("");
      setShowCreateModal(false);
      setSelectedGroupId(result.group.id);
      setMessage("权限组已创建");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建权限组失败");
    }
  }

  async function onSaveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedGroup) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      await updatePermissionGroup(selectedGroup.id, {
        name: editName,
        description: editDescription,
      });
      setMessage("权限组已更新");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新权限组失败");
    }
  }

  async function onDeleteGroup() {
    if (!selectedGroup) {
      return;
    }

    if (!window.confirm(`删除权限组「${selectedGroup.name}」？`)) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      await deletePermissionGroup(selectedGroup.id);
      setSelectedGroupId("");
      setMessage("权限组已删除");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除权限组失败");
    }
  }

  async function addMember(userId: string) {
    if (!selectedGroup || !userId) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const result = await addPermissionGroupMember(selectedGroup.id, userId);
      setGroups((current) =>
        current.map((group) =>
          group.id === result.group.id ? result.group : group,
        ),
      );
      setMessage("成员已加入权限组");
      setCandidateQuery("");
      setShowMemberPicker(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "添加成员失败");
    }
  }

  async function onRemoveMember(userId: string) {
    if (!selectedGroup) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const result = await removePermissionGroupMember(
        selectedGroup.id,
        userId,
      );
      setGroups((current) =>
        current.map((group) =>
          group.id === result.group.id ? result.group : group,
        ),
      );
      setMessage("成员已移出权限组");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移除成员失败");
    }
  }

  return (
    <div className="workspace permission-groups-workspace">
      <header className="page-head">
        <div>
          <h1>权限组</h1>
          <p className="muted">按职责组织成员，供文档授权时直接选择。</p>
        </div>
      </header>

      <AdminSubnav />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="workbench permission-groups-layout">
        <aside className="workbench-side sticky-panel">
          <section className="action-panel permission-group-list-panel">
            <div className="panel-title-row">
              <h2>权限组列表</h2>
              <button
                className="button secondary"
                onClick={() => setShowCreateModal(true)}
                type="button"
              >
                <Plus aria-hidden="true" className="button-icon" />
                新建权限组
              </button>
            </div>
            <div className="permission-group-search">
              <Search aria-hidden="true" />
              <input
                placeholder="搜索权限组"
                value={groupQuery}
                onChange={(event) => setGroupQuery(event.target.value)}
              />
            </div>
            <div className="group-list" aria-label="权限组列表">
              {filteredGroups.map((group) => (
                <button
                  className={`group-list-item ${
                    selectedGroup?.id === group.id ? "active" : ""
                  }`}
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  type="button"
                >
                  <span>
                    <strong>{group.name}</strong>
                    <small>{group.description || "未填写描述"}</small>
                  </span>
                  <em>{group.memberCount}</em>
                </button>
              ))}
              {groups.length === 0 ? (
                <div className="empty-panel compact">
                  <strong>还没有权限组</strong>
                  <span>先创建一个组，再把成员加入进去。</span>
                </div>
              ) : null}
              {groups.length > 0 && filteredGroups.length === 0 ? (
                <div className="empty-panel compact">
                  <strong>没有匹配结果</strong>
                  <span>换个关键词再试。</span>
                </div>
              ) : null}
            </div>
          </section>
        </aside>

        <section className="workbench-main">
          {selectedGroup ? (
            <section className="permission-group-detail">
              <header className="panel-head">
                <div>
                  <h2>{selectedGroup.name}</h2>
                  <p className="muted">
                    {selectedGroup.description || "未填写描述"}
                  </p>
                </div>
              </header>

              <div className="permission-group-detail-grid">
                <section className="permission-group-members">
                  <div className="panel-title-row">
                    <div>
                      <h3>成员</h3>
                      <span className="muted">{selectedMembers.length} 人</span>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => setShowMemberPicker((current) => !current)}
                      type="button"
                    >
                      <UserPlus aria-hidden="true" />
                      添加成员
                    </button>
                  </div>

                  {showMemberPicker ? (
                    <div className="permission-member-picker">
                      <label className="permission-group-search">
                        <Search aria-hidden="true" />
                        <input
                          autoFocus
                          placeholder="搜索要添加的成员"
                          value={candidateQuery}
                          onChange={(event) =>
                            setCandidateQuery(event.target.value)
                          }
                        />
                      </label>
                      <div className="permission-member-candidates">
                        {filteredCandidates.map((user) => (
                          <div key={user.id}>
                            <button
                              onClick={() => void addMember(user.id)}
                              type="button"
                            >
                              <span className="permission-member-avatar">
                                {user.displayName.charAt(0).toUpperCase()}
                              </span>
                              <span>
                                <strong>{user.displayName}</strong>
                              </span>
                              <Plus aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                        {filteredCandidates.length === 0 ? (
                          <p className="muted">没有可添加的成员</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <label className="permission-group-search permission-member-search">
                    <Search aria-hidden="true" />
                    <input
                      placeholder="搜索组内成员"
                      value={memberQuery}
                      onChange={(event) => setMemberQuery(event.target.value)}
                    />
                  </label>

                  <div className="permission-member-list">
                    {filteredMembers.map((member) => (
                      <div className="permission-member-row" key={member.id}>
                        <span className="permission-member-avatar">
                          {member.user.displayName.charAt(0).toUpperCase()}
                        </span>
                        <span>
                          <strong>
                            <UserProfileLink
                              className="user-profile-link"
                              user={member.user}
                            />
                          </strong>
                        </span>
                        <span className="permission-member-status">
                          <Check aria-hidden="true" />
                          {userStatusLabel(member.user.status)}
                        </span>
                        <button
                          className="inline-icon-button"
                          onClick={() => void onRemoveMember(member.user.id)}
                          title="移出权限组"
                          type="button"
                        >
                          <X aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                    {selectedGroup.memberCount === 0 ? (
                      <div className="empty-panel compact">
                        <Users aria-hidden="true" />
                        <strong>组内暂无成员</strong>
                        <span>添加成员后即可用这个组授权文档。</span>
                      </div>
                    ) : null}
                    {selectedMembers.length > 0 &&
                    filteredMembers.length === 0 ? (
                      <div className="empty-panel compact">
                        <strong>没有匹配成员</strong>
                      </div>
                    ) : null}
                  </div>
                </section>

                <form
                  className="permission-group-settings"
                  onSubmit={onSaveGroup}
                >
                  <div className="panel-title-row">
                    <h3>组信息</h3>
                  </div>
                  <div className="permission-group-form-grid">
                    <label className="label">
                      名称
                      <input
                        className="input"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                      />
                    </label>
                    <label className="label">
                      用途说明
                      <textarea
                        className="textarea"
                        rows={3}
                        value={editDescription}
                        onChange={(event) =>
                          setEditDescription(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <button className="button secondary" type="submit">
                    保存修改
                  </button>
                  <div className="permission-group-danger-row">
                    <button
                      className="button danger permission-group-delete"
                      onClick={onDeleteGroup}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" />
                      删除权限组
                    </button>
                  </div>
                </form>
              </div>
            </section>
          ) : (
            <div className="empty-panel">
              <strong>选择或创建权限组</strong>
              <span>权限组会成为后续所有赋权和除权操作的唯一对象。</span>
            </div>
          )}
        </section>
      </section>

      {showCreateModal ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-panel" onSubmit={onCreateGroup}>
            <div className="modal-head">
              <h2>
                <ShieldCheck aria-hidden="true" className="heading-icon" />
                新建权限组
              </h2>
              <button
                className="icon-button subtle"
                onClick={() => setShowCreateModal(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <label className="label">
                组名
                <input
                  autoFocus
                  className="input"
                  placeholder="例如：助教"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="label">
                描述
                <textarea
                  className="textarea"
                  placeholder="描述这个权限组负责的成员范围"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setShowCreateModal(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={!name.trim()}
                  type="submit"
                >
                  创建权限组
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
