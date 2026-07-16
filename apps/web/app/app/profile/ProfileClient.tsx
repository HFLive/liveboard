"use client";

import {
  ChangeEvent,
  FormEvent,
  MouseEvent,
  PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Camera,
  ImagePlus,
  KeyRound,
  Upload,
  UserRound,
  X,
} from "lucide-react";
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

const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_BANNER_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_CANVAS_SIZE = 512;
const AVATAR_CROP_VIEW_SIZE = 280;

type CropOffset = { x: number; y: number };

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
  const [avatarSourceUrl, setAvatarSourceUrl] = useState<string | null>(null);
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarOffset, setAvatarOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [avatarDragging, setAvatarDragging] = useState(false);
  const [avatarDragStart, setAvatarDragStart] = useState<{
    pointer: CropOffset;
    offset: CropOffset;
  } | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [savingBanner, setSavingBanner] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const avatarImageRef = useRef<HTMLImageElement | null>(null);

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
      if (avatarSourceUrl) {
        URL.revokeObjectURL(avatarSourceUrl);
      }
    };
  }, [avatarSourceUrl]);

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

  async function onSelectBanner(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setError(null);
    setProfileMessage(null);

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Banner 仅支持 PNG、JPEG 或 WebP 图片");
      return;
    }

    if (file.size > MAX_BANNER_UPLOAD_BYTES) {
      setError("Banner 图片不能超过 5MB");
      return;
    }

    setSavingBanner(true);
    try {
      const result = await uploadProfileBanner(file);
      setUser(result.user);
      setProfileMessage("Banner 已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Banner 上传失败");
    } finally {
      setSavingBanner(false);
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

  function onSelectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setError(null);
    setProfileMessage(null);

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("头像仅支持 PNG、JPEG 或 WebP 图片");
      return;
    }

    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      setError("头像图片不能超过 2MB");
      return;
    }

    if (avatarSourceUrl) {
      URL.revokeObjectURL(avatarSourceUrl);
    }

    setAvatarSourceUrl(URL.createObjectURL(file));
    setAvatarZoom(1);
    setAvatarOffset({ x: 0, y: 0 });
  }

  function closeAvatarEditor() {
    if (avatarSourceUrl) {
      URL.revokeObjectURL(avatarSourceUrl);
    }
    setAvatarSourceUrl(null);
    setAvatarDragging(false);
    setAvatarDragStart(null);
  }

  function onAvatarPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setAvatarDragging(true);
    setAvatarDragStart({
      pointer: { x: event.clientX, y: event.clientY },
      offset: avatarOffset,
    });
  }

  function onAvatarPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!avatarDragging || !avatarDragStart) return;

    const nextOffset = {
      x: avatarDragStart.offset.x + event.clientX - avatarDragStart.pointer.x,
      y: avatarDragStart.offset.y + event.clientY - avatarDragStart.pointer.y,
    };
    setAvatarOffset(limitAvatarOffset(nextOffset, avatarZoom));
  }

  function onAvatarPointerUp(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setAvatarDragging(false);
    setAvatarDragStart(null);
  }

  function onBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !savingAvatar) {
      closeAvatarEditor();
    }
  }

  async function onConfirmAvatar() {
    const image = avatarImageRef.current;

    if (!image) {
      setError("头像图片尚未加载完成");
      return;
    }

    setError(null);
    setSavingAvatar(true);

    try {
      const file = await renderAvatarFile(image, avatarZoom, avatarOffset);
      if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
        throw new Error("裁剪后的头像仍超过 2MB，请换一张更小的图片");
      }
      const result = await uploadAvatar(file);
      setUser(result.user);
      window.dispatchEvent(new Event("liveboard:profile-updated"));
      setProfileMessage("头像已更新");
      closeAvatarEditor();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "头像上传失败");
    } finally {
      setSavingAvatar(false);
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
                  onChange={onSelectBanner}
                  ref={bannerInputRef}
                  type="file"
                />
                <button
                  className="button secondary"
                  disabled={savingBanner}
                  onClick={() => bannerInputRef.current?.click()}
                  type="button"
                >
                  <ImagePlus aria-hidden="true" className="button-icon" />
                  {savingBanner ? "上传中" : "更换 Banner"}
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
                  onChange={onSelectAvatar}
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

      {avatarSourceUrl ? (
        <div
          className="modal-backdrop"
          onMouseDown={onBackdropMouseDown}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="modal-panel avatar-crop-modal"
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <h2>裁剪头像</h2>
              </div>
              <button
                aria-label="关闭"
                className="inline-icon-button"
                disabled={savingAvatar}
                onClick={closeAvatarEditor}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body avatar-crop-body">
              <div
                className={
                  avatarDragging
                    ? "avatar-crop-stage dragging"
                    : "avatar-crop-stage"
                }
                onPointerDown={onAvatarPointerDown}
                onPointerMove={onAvatarPointerMove}
                onPointerUp={onAvatarPointerUp}
              >
                <img
                  alt=""
                  draggable={false}
                  onLoad={() => setAvatarOffset({ x: 0, y: 0 })}
                  ref={avatarImageRef}
                  src={avatarSourceUrl}
                  style={{
                    transform: `translate(${avatarOffset.x}px, ${avatarOffset.y}px) scale(${avatarZoom})`,
                  }}
                />
              </div>
              <label className="label avatar-zoom-label">
                缩放
                <input
                  max="3"
                  min="1"
                  onChange={(event) => {
                    const nextZoom = Number(event.target.value);
                    setAvatarZoom(nextZoom);
                    setAvatarOffset((current) =>
                      limitAvatarOffset(current, nextZoom),
                    );
                  }}
                  step="0.05"
                  type="range"
                  value={avatarZoom}
                />
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={savingAvatar}
                  onClick={closeAvatarEditor}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={savingAvatar}
                  onClick={onConfirmAvatar}
                  type="button"
                >
                  <Upload aria-hidden="true" className="button-icon" />
                  {savingAvatar ? "上传中" : "确认头像"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function limitAvatarOffset(offset: CropOffset, zoom: number) {
  const limit = ((zoom - 1) * AVATAR_CROP_VIEW_SIZE) / 2;

  return {
    x: Math.max(-limit, Math.min(limit, offset.x)),
    y: Math.max(-limit, Math.min(limit, offset.y)),
  };
}

async function renderAvatarFile(
  image: HTMLImageElement,
  zoom: number,
  offset: CropOffset,
) {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("浏览器无法处理头像图片");
  }

  const naturalSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceSize = naturalSize / zoom;
  const sourceX =
    (image.naturalWidth - sourceSize) / 2 -
    (offset.x / AVATAR_CROP_VIEW_SIZE) * sourceSize;
  const sourceY =
    (image.naturalHeight - sourceSize) / 2 -
    (offset.y / AVATAR_CROP_VIEW_SIZE) * sourceSize;
  const safeSourceX = Math.max(
    0,
    Math.min(image.naturalWidth - sourceSize, sourceX),
  );
  const safeSourceY = Math.max(
    0,
    Math.min(image.naturalHeight - sourceSize, sourceY),
  );

  context.drawImage(
    image,
    safeSourceX,
    safeSourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_CANVAS_SIZE,
    AVATAR_CANVAS_SIZE,
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", 0.9);
  });

  if (!blob) {
    throw new Error("头像图片处理失败");
  }

  return new File([blob], "avatar.webp", { type: "image/webp" });
}
