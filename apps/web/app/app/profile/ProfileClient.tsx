"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, UserRound } from "lucide-react";
import type { UserSummary } from "@liveboard/shared";
import { changePassword, getMe, updateProfile } from "@/lib/api";
import { roleLabel, userStatusLabel } from "@/lib/labels";

export function ProfileClient() {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    getMe()
      .then((result) => {
        setUser(result.user);
        setDisplayName(result.user.displayName);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载个人信息失败");
      });
  }, []);

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setProfileMessage(null);

    if (!displayName.trim()) {
      setError("显示名不能为空");
      return;
    }

    setSavingProfile(true);

    try {
      const result = await updateProfile({ displayName: displayName.trim() });
      setUser(result.user);
      setDisplayName(result.user.displayName);
      window.dispatchEvent(new Event("liveboard:profile-updated"));
      setProfileMessage("个人信息已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存个人信息失败");
    } finally {
      setSavingProfile(false);
    }
  }

  async function onChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPasswordMessage(null);

    if (newPassword.length < 8) {
      setError("新密码至少需要 8 位");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setSavingPassword(true);

    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密码已修改");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改密码失败");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">账户</p>
          <h1>个人设置</h1>
          <p className="muted">维护个人资料、登录身份与账户安全。</p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="workbench profile-layout">
        <div className="workbench-main">
          <div className="panel-head">
            <div>
              <h2>
                <UserRound aria-hidden="true" className="heading-icon" />
                账号资料
              </h2>
            </div>
          </div>

          <form className="profile-form" onSubmit={onSaveProfile}>
            <label className="label">
              显示名
              <input
                className="input"
                onChange={(event) => setDisplayName(event.target.value)}
                value={displayName}
              />
            </label>
            <div className="profile-readonly-grid">
              <div>
                <span>登录账号</span>
                <strong>{user?.username ?? "-"}</strong>
              </div>
              <div>
                <span>系统权限</span>
                <strong>{user ? roleLabel(user.systemRole) : "-"}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{user ? userStatusLabel(user.status) : "-"}</strong>
              </div>
            </div>
            {profileMessage ? (
              <p className="success-text">{profileMessage}</p>
            ) : null}
            <div className="button-row left">
              <button className="button" disabled={savingProfile} type="submit">
                {savingProfile ? "保存中" : "保存信息"}
              </button>
            </div>
          </form>
        </div>

        <aside className="workbench-side">
          <details className="action-panel disclosure-panel password-panel">
            <summary>
              <span>
                <KeyRound aria-hidden="true" className="heading-icon" />
                修改密码
              </span>
              <small>安全操作</small>
            </summary>
            <form className="form disclosure-body" onSubmit={onChangePassword}>
              <label className="label">
                当前密码
                <input
                  autoComplete="current-password"
                  className="input"
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  type="password"
                  value={currentPassword}
                />
              </label>
              <label className="label">
                新密码
                <input
                  autoComplete="new-password"
                  className="input"
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  value={newPassword}
                />
              </label>
              <label className="label">
                确认新密码
                <input
                  autoComplete="new-password"
                  className="input"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  value={confirmPassword}
                />
              </label>
              {passwordMessage ? (
                <p className="success-text">{passwordMessage}</p>
              ) : null}
              <button
                className="button secondary"
                disabled={savingPassword}
                type="submit"
              >
                {savingPassword ? "修改中" : "修改密码"}
              </button>
            </form>
          </details>

          <section className="action-panel quiet">
            <h2>账号说明</h2>
            <p className="muted">登录账号和系统权限由管理员创建和维护。</p>
          </section>
        </aside>
      </section>
    </div>
  );
}
