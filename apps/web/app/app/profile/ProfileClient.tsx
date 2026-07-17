"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, KeyRound, UserRound } from "lucide-react";
import type { UserProfile } from "@liveboard/shared";
import {
  apiResourceUrl,
  changePassword,
  getMe,
  updateProfile,
  uploadAvatar,
  uploadProfileBanner,
} from "@/lib/api";
import { roleLabel, userStatusLabel } from "@/lib/labels";
import { ImageCropDialog } from "@/components/ImageCropDialog";

const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_BANNER_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_OUTPUT_SIZE = 512;
const BANNER_OUTPUT_WIDTH = 1600;
const BANNER_OUTPUT_HEIGHT = 400;

type CropTarget = "avatar" | "banner";

const CROP_CONFIG: Record<
  CropTarget,
  {
    title: string;
    aspect: number;
    outputWidth: number;
    outputHeight: number;
    outputFileName: string;
    confirmLabel: string;
  }
> = {
  avatar: {
    title: "裁剪头像",
    aspect: 1,
    outputWidth: AVATAR_OUTPUT_SIZE,
    outputHeight: AVATAR_OUTPUT_SIZE,
    outputFileName: "avatar.webp",
    confirmLabel: "确认头像",
  },
  banner: {
    title: "裁剪 Banner",
    aspect: BANNER_OUTPUT_WIDTH / BANNER_OUTPUT_HEIGHT,
    outputWidth: BANNER_OUTPUT_WIDTH,
    outputHeight: BANNER_OUTPUT_HEIGHT,
    outputFileName: "banner.webp",
    confirmLabel: "确认 Banner",
  },
};

export function ProfileClient() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null);
  const [savingCrop, setSavingCrop] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getMe()
      .then((result) => {
        setUser(result.user);
        setDisplayName(result.user.displayName);
        setBio(result.user.bio ?? "");
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载个人信息失败");
      });
  }, []);

  useEffect(() => {
    return () => {
      if (cropSourceUrl) {
        URL.revokeObjectURL(cropSourceUrl);
      }
    };
  }, [cropSourceUrl]);

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
      const result = await updateProfile({
        displayName: displayName.trim(),
        bio,
      });
      setUser(result.user);
      setDisplayName(result.user.displayName);
      setBio(result.user.bio ?? "");
      window.dispatchEvent(new Event("liveboard:profile-updated"));
      setProfileMessage("个人信息已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存个人信息失败");
    } finally {
      setSavingProfile(false);
    }
  }

  function selectCropFile(
    event: ChangeEvent<HTMLInputElement>,
    target: CropTarget,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setError(null);
    setProfileMessage(null);

    const label = target === "avatar" ? "头像" : "Banner";
    const maxBytes =
      target === "avatar" ? MAX_AVATAR_UPLOAD_BYTES : MAX_BANNER_UPLOAD_BYTES;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(`${label}仅支持 PNG、JPEG 或 WebP 图片`);
      return;
    }

    if (file.size > maxBytes) {
      setError(
        target === "avatar"
          ? "头像图片不能超过 2MB"
          : "Banner 图片不能超过 5MB",
      );
      return;
    }

    if (cropSourceUrl) {
      URL.revokeObjectURL(cropSourceUrl);
    }

    setCropSourceUrl(URL.createObjectURL(file));
    setCropTarget(target);
  }

  function closeCropDialog() {
    if (cropSourceUrl) {
      URL.revokeObjectURL(cropSourceUrl);
    }
    setCropSourceUrl(null);
    setCropTarget(null);
  }

  async function onConfirmCrop(file: File) {
    if (!cropTarget) return;

    setError(null);
    setSavingCrop(true);

    try {
      const result =
        cropTarget === "avatar"
          ? await uploadAvatar(file)
          : await uploadProfileBanner(file);
      setUser(result.user);
      if (cropTarget === "avatar") {
        window.dispatchEvent(new Event("liveboard:profile-updated"));
      }
      setProfileMessage(
        cropTarget === "avatar" ? "头像已更新" : "Banner 已更新",
      );
      closeCropDialog();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : cropTarget === "avatar"
            ? "头像上传失败"
            : "Banner 上传失败",
      );
    } finally {
      setSavingCrop(false);
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
            <div className="profile-banner-editor">
              <div className="profile-banner-preview" aria-hidden="true">
                {user?.bannerUrl ? (
                  <img alt="" src={apiResourceUrl(user.bannerUrl)} />
                ) : (
                  <ImagePlus />
                )}
              </div>
              <div className="profile-banner-actions">
                <div>
                  <strong>个人主页 Banner</strong>
                  <p className="muted">
                    支持 PNG、JPEG、WebP，图片不超过 5MB。
                  </p>
                </div>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => selectCropFile(event, "banner")}
                  ref={bannerInputRef}
                  type="file"
                />
                <button
                  className="button secondary"
                  disabled={savingCrop}
                  onClick={() => bannerInputRef.current?.click()}
                  type="button"
                >
                  <ImagePlus aria-hidden="true" className="button-icon" />
                  {savingCrop ? "上传中" : "更换 Banner"}
                </button>
              </div>
            </div>
            <div className="profile-avatar-row">
              <div className="profile-avatar-preview" aria-hidden="true">
                {user?.avatarUrl ? (
                  <img alt="" src={apiResourceUrl(user.avatarUrl)} />
                ) : (
                  displayName.trim().slice(0, 1).toUpperCase() || "L"
                )}
              </div>
              <div>
                <strong>头像</strong>
                <p className="muted">支持 PNG、JPEG、WebP，原图不超过 2MB。</p>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => selectCropFile(event, "avatar")}
                  ref={avatarInputRef}
                  type="file"
                />
                <button
                  className="button secondary"
                  onClick={() => avatarInputRef.current?.click()}
                  type="button"
                >
                  <Camera aria-hidden="true" className="button-icon" />
                  上传头像
                </button>
              </div>
            </div>
            <label className="label">
              显示名
              <input
                className="input"
                onChange={(event) => setDisplayName(event.target.value)}
                value={displayName}
              />
            </label>
            <label className="label">
              个人简介
              <textarea
                className="textarea profile-bio-input"
                maxLength={500}
                onChange={(event) => setBio(event.target.value)}
                placeholder="介绍一下自己"
                rows={5}
                value={bio}
              />
              <small className="muted">{bio.length}/500</small>
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
          <details className="password-disclosure">
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
        </aside>
      </section>

      {cropTarget && cropSourceUrl ? (
        <ImageCropDialog
          aspect={CROP_CONFIG[cropTarget].aspect}
          confirmLabel={CROP_CONFIG[cropTarget].confirmLabel}
          onCancel={closeCropDialog}
          onConfirm={(file) => void onConfirmCrop(file)}
          outputFileName={CROP_CONFIG[cropTarget].outputFileName}
          outputHeight={CROP_CONFIG[cropTarget].outputHeight}
          outputWidth={CROP_CONFIG[cropTarget].outputWidth}
          saving={savingCrop}
          sourceUrl={cropSourceUrl}
          title={CROP_CONFIG[cropTarget].title}
        />
      ) : null}
    </div>
  );
}
