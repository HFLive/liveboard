import type {
  AdminUserSummary,
  AdminBadgeSummary,
  AiProviderConfigSummary,
  AiSettingsSummary,
  AiUsageSummary,
  ContentBlockType,
  ContentPinTarget,
  ClassroomAnnouncementSummary,
  ClassroomMemberRole,
  ClassroomMemberSummary,
  ClassroomSummary,
  FileSummary,
  FolderAssetSummary,
  FolderNode,
  ForumCategorySummary,
  ForumImageSummary,
  ForumPostSummary,
  ForumThreadDetail,
  ForumThreadSummary,
  ForumThreadStatus,
  NotificationCategory,
  NotificationListResult,
  ObjectUploadInstruction,
  PermissionLevel,
  PermissionTargetType,
  QuestionType,
  ServerStatusSummary,
  SignedUploadResponse,
  SystemRole,
  TeachingDeckSummary,
  TeachingDeckItemType,
  UserProfile,
  UserPublicActivity,
  UserBadgeSummary,
  BadgeColor,
  UserTagSummary,
  UserSummary,
} from "@liveboard/shared";
import {
  ALLOW_RELAY_FALLBACK,
  API_URL,
  ApiError,
  redirectToLoginOnUnauthorized,
  request,
  uploadFormData,
  uploadToObjectStorage,
  type UploadRequestOptions,
} from "./client";

export { ApiError } from "./client";

export function apiResourceUrl(path: string) {
  return path.startsWith("http") ? path : `${API_URL}${path}`;
}

// 附件资源默认按 Content-Disposition: inline 返回安全图片，便于 <img> 引用；
// 下载场景需要显式带上 download=1，让 API 强制改为 attachment，避免浏览器
// 直接打开裸文件页。
export function assetDownloadUrl(assetId: string) {
  return apiResourceUrl(`/assets/${assetId}?download=1`);
}

export async function fetchFilePreview(path: string, signal?: AbortSignal) {
  const response = await fetch(apiResourceUrl(path), {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    redirectToLoginOnUnauthorized(response.status, path);
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join("；")
      : body?.message;
    throw new ApiError(message ?? "无法加载文件预览", response.status);
  }
  return response;
}

export function fetchAssetPreview(assetId: string, signal?: AbortSignal) {
  return fetchFilePreview(`/assets/${assetId}/preview`, signal);
}

// PDF 预览直传：向 /assets/:id/preview-url（或 classroom 对应端点）取短期
// 预签名 URL，浏览器直接拉对象存储做流式加载。url 为 null 时回退到 /preview 中转。
export function fetchPreviewUrl(
  path: string,
  signal?: AbortSignal,
): Promise<{ url: string | null }> {
  return request<{ url: string | null }>(path, { signal });
}

// 内容块里的附件链接指向 /assets/:id，点击图片类附件会打开裸图页；
// 统一补 download=1 强制下载，外部链接原样返回。
export function attachmentDownloadUrl(url: string) {
  const isAssetUrl =
    url.startsWith("/assets/") || url.startsWith(`${API_URL}/assets/`);
  if (!isAssetUrl) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}download=1`;
}

let currentUserRequest: Promise<{ user: UserProfile }> | null = null;
let currentUserCache:
  { value: { user: UserProfile }; expiresAt: number } | undefined;
const CURRENT_USER_CACHE_MS = 5_000;

function clearCurrentUserCache() {
  currentUserRequest = null;
  currentUserCache = undefined;
}

export function login(username: string, password: string) {
  clearCurrentUserCache();
  return request<{ user: UserSummary }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  clearCurrentUserCache();
  return request<{ ok: boolean }>("/auth/logout", {
    method: "POST",
  });
}

export function getMe() {
  if (currentUserCache && currentUserCache.expiresAt > Date.now()) {
    return Promise.resolve(currentUserCache.value);
  }

  if (!currentUserRequest) {
    currentUserRequest = request<{ user: UserProfile }>("/auth/me")
      .then((result) => {
        currentUserCache = {
          value: result,
          expiresAt: Date.now() + CURRENT_USER_CACHE_MS,
        };
        return result;
      })
      .finally(() => {
        currentUserRequest = null;
      });
  }

  return currentUserRequest;
}

export function getUserProfile(userId: string) {
  return request<{ user: UserProfile }>(`/auth/profile/${userId}`);
}

export function getUserPublicActivity(userId: string) {
  return request<UserPublicActivity>(`/auth/profile/${userId}/activity`);
}

export function listNotifications(input?: {
  status?: "all" | "unread";
  category?: NotificationCategory;
  cursor?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (input?.status && input.status !== "all") {
    params.set("status", input.status);
  }
  if (input?.category) params.set("category", input.category);
  if (input?.cursor) params.set("cursor", input.cursor);
  if (input?.limit) params.set("limit", String(input.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request<NotificationListResult>(`/notifications${query}`);
}

export function markAllNotificationsRead() {
  return request<{ updatedCount: number }>("/notifications/read", {
    method: "POST",
  });
}

export function setNotificationRead(notificationId: string, read: boolean) {
  return request<{ read: boolean }>(
    `/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: read ? "POST" : "DELETE" },
  );
}

export function archiveNotification(notificationId: string) {
  return request<{ archived: true }>(
    `/notifications/${encodeURIComponent(notificationId)}`,
    { method: "DELETE" },
  );
}

export function updateProfile(input: { displayName: string; bio?: string }) {
  clearCurrentUserCache();
  return request<{ user: UserProfile }>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  }).then((result) => {
    currentUserCache = {
      value: result,
      expiresAt: Date.now() + CURRENT_USER_CACHE_MS,
    };
    return result;
  });
}

export async function uploadAvatar(file: File) {
  clearCurrentUserCache();
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch(`${API_URL}/auth/me/avatar`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    redirectToLoginOnUnauthorized(response.status, "/auth/me/avatar");
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join("；")
      : body?.message;
    throw new ApiError(message ?? "头像上传失败", response.status);
  }

  return (await response.json()) as { user: UserProfile };
}

export async function uploadProfileBanner(file: File) {
  clearCurrentUserCache();
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch(`${API_URL}/auth/me/banner`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    redirectToLoginOnUnauthorized(response.status, "/auth/me/banner");
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join("；")
      : body?.message;
    throw new ApiError(message ?? "Banner 上传失败", response.status);
  }

  return (await response.json()) as { user: UserProfile };
}

function abortBannerUpload(uploadId: string) {
  return request<{ ok: boolean }>("/auth/me/banner/upload-abort", {
    method: "POST",
    body: JSON.stringify({ uploadId }),
  }).catch(() => undefined);
}

/**
 * Banner 直传（Vercel 下 5MB 超过普通请求体上限必须直传）。自托管下
 * 签名 501 或直传失败时回退服务器中转；Vercel 下直传失败直接抛出。
 */
export async function uploadProfileBannerDirect(
  file: File,
  options?: UploadRequestOptions,
) {
  let signed: SignedUploadResponse;
  try {
    signed = await request<SignedUploadResponse>("/auth/me/banner/upload-url", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        sizeBytes: file.size,
        mimeType: file.type || undefined,
      }),
    });
  } catch (caught) {
    if (
      ALLOW_RELAY_FALLBACK &&
      caught instanceof ApiError &&
      caught.status === 501
    ) {
      return uploadProfileBanner(file);
    }
    throw caught;
  }

  try {
    await uploadToObjectStorage(
      signed.instruction,
      signed.uploadId,
      file,
      options,
    );
  } catch (caught) {
    await abortBannerUpload(signed.uploadId);
    if (isAbortError(caught)) throw caught;
    if (ALLOW_RELAY_FALLBACK) return uploadProfileBanner(file);
    throw caught;
  }

  clearCurrentUserCache();
  return request<{ user: UserProfile }>("/auth/me/banner/upload-confirm", {
    method: "POST",
    body: JSON.stringify({ uploadId: signed.uploadId }),
  });
}

export function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  clearCurrentUserCache();
  return request<{ ok: boolean }>("/auth/password", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listUsers() {
  return request<{ users: AdminUserSummary[] }>("/admin/users");
}

export function listVisibilityUsers() {
  return request<{ users: UserSummary[]; tags: UserTagSummary[] }>(
    "/users/visibility-options",
  );
}

export function listUserTags() {
  return request<{ tags: UserTagSummary[] }>("/admin/user-tags");
}

export function createUserTag(name: string) {
  return request<{ tag: UserTagSummary }>("/admin/user-tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateUserTag(tagId: string, name: string) {
  return request<{ tag: UserTagSummary }>(`/admin/user-tags/${tagId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteUserTag(tagId: string) {
  return request<{ ok: boolean }>(`/admin/user-tags/${tagId}`, {
    method: "DELETE",
  });
}

export function setUserTags(userId: string, tagIds: string[]) {
  return request<{ user: UserSummary }>(`/admin/users/${userId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tagIds }),
  });
}

export function listMyBadges() {
  return request<{ badges: UserBadgeSummary[] }>("/badges/me");
}

export function setEquippedBadges(badgeIds: string[]) {
  clearCurrentUserCache();
  return request<{ badges: UserBadgeSummary[] }>("/badges/me/equipped", {
    method: "PUT",
    body: JSON.stringify({ badgeIds }),
  });
}

export function listAdminBadges() {
  return request<{ badges: AdminBadgeSummary[] }>("/admin/badges");
}

export function createBadge(input: {
  name: string;
  description?: string;
  color: BadgeColor;
}) {
  return request<{ badge: AdminBadgeSummary }>("/admin/badges", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateBadge(
  badgeId: string,
  input: { name?: string; description?: string; color?: BadgeColor },
) {
  return request<{ badge: AdminBadgeSummary }>(
    `/admin/badges/${encodeURIComponent(badgeId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteBadge(badgeId: string) {
  return request<{ ok: true }>(`/admin/badges/${encodeURIComponent(badgeId)}`, {
    method: "DELETE",
  });
}

export function awardBadge(badgeId: string, userId: string) {
  return request<{ ok: true }>(
    `/admin/badges/${encodeURIComponent(badgeId)}/users/${encodeURIComponent(userId)}`,
    { method: "PUT" },
  );
}

export function revokeBadge(badgeId: string, userId: string) {
  return request<{ ok: true }>(
    `/admin/badges/${encodeURIComponent(badgeId)}/users/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}

export interface PermissionGrantSummary {
  id: string;
  targetType: PermissionTargetType;
  targetId: string;
  userId: string;
  level: PermissionLevel;
  user: UserSummary;
}

export interface InheritedPermissionGrantSummary extends PermissionGrantSummary {
  inheritedFrom: {
    targetType: PermissionTargetType;
    targetId: string;
    targetName: string;
  };
}

export interface PermissionGrantListResponse {
  grants: PermissionGrantSummary[];
  inheritedGrants: InheritedPermissionGrantSummary[];
}

export function getDefaultPermissionWorkspace() {
  return request<{ workspace: { id: string; name: string } }>(
    "/permissions/workspace-default",
  );
}

export function listPermissionGrants(
  targetType: PermissionTargetType,
  targetId: string,
) {
  const search = new URLSearchParams({ targetType, targetId });
  return request<PermissionGrantListResponse>(
    `/permissions?${search.toString()}`,
  );
}

export function listAssignablePermissionUsers(input: {
  targetType: PermissionTargetType;
  targetId: string;
}) {
  const search = new URLSearchParams(input);
  return request<{ users: UserSummary[]; tags: UserTagSummary[] }>(
    `/permissions/assignable?${search.toString()}`,
  );
}

export function upsertPermissionGrant(input: {
  targetType: PermissionTargetType;
  targetId: string;
  userId: string;
  level: PermissionLevel;
}) {
  return request<{ grant: PermissionGrantSummary }>("/permissions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deletePermissionGrant(grantId: string) {
  return request<{ ok: boolean }>(`/permissions/${grantId}`, {
    method: "DELETE",
  });
}

export function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  systemRole: SystemRole;
}) {
  return request<{ user: UserSummary }>("/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface ImportUsersResult {
  created: UserSummary[];
  skipped: Array<{ rowNumber: number; username: string; reason: string }>;
  failed: Array<{ rowNumber: number; username: string; reason: string }>;
}

export function importUsers(input: {
  users: Array<{
    username: string;
    displayName: string;
    password: string;
    systemRole: SystemRole;
  }>;
}) {
  return request<{ result: ImportUsersResult }>("/admin/users/import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateUser(
  userId: string,
  input: {
    displayName?: string;
    systemRole?: SystemRole;
    status?: UserSummary["status"];
    password?: string;
    storageQuotaBytes?: number | null;
    aiCallLimit?: number | null;
  },
) {
  return request<{ user: UserSummary }>(`/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface UserStorageSummary {
  user: UserSummary;
  storageQuotaBytes: number;
  storageQuotaCustom: boolean;
  storageUsedBytes: number;
  assetCount: number;
}

export function listUserStorage() {
  return request<{ users: UserStorageSummary[] }>("/admin/users/storage");
}

export function updateUserStorageQuota(
  userId: string,
  storageQuotaBytes: number | null,
) {
  return updateUser(userId, { storageQuotaBytes });
}

export interface StorageQuotaDefaults {
  memberAttachmentQuotaBytes: number;
  memberAttachmentQuotaCustom: boolean;
  classroomStorageQuotaBytes: number;
  classroomStorageQuotaCustom: boolean;
}

export function getStorageQuotaDefaults() {
  return request<{ defaults: StorageQuotaDefaults }>(
    "/admin/users/storage/quota-defaults",
  );
}

export function updateStorageQuotaDefaults(input: {
  memberAttachmentQuotaBytes?: number | null;
  classroomStorageQuotaBytes?: number | null;
}) {
  return request<{ defaults: StorageQuotaDefaults }>(
    "/admin/users/storage/quota-defaults",
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export interface SystemSettings {
  workspaceName: string;
  workspaceSlug: string;
  timeZone: string;
  faviconUrl: string | null;
  faviconLightUrl: string | null;
  faviconDarkUrl: string | null;
  updatedAt: string;
}

export type FaviconVariant = "default" | "light" | "dark";

let publicSettingsRequest: Promise<{ settings: SystemSettings }> | null = null;

export function getPublicSettings() {
  if (!publicSettingsRequest) {
    publicSettingsRequest = request<{ settings: SystemSettings }>(
      "/settings/public",
    ).finally(() => {
      publicSettingsRequest = null;
    });
  }

  return publicSettingsRequest;
}

export function getSystemSettings() {
  return request<{ settings: SystemSettings }>("/admin/settings");
}

export function updateSystemSettings(input: Partial<{ timeZone: string }>) {
  return request<{ settings: SystemSettings }>("/admin/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function uploadSystemFavicon(
  file: File,
  variant: FaviconVariant = "default",
) {
  const formData = new FormData();
  formData.set("file", file);
  const path =
    variant === "default"
      ? "/admin/settings/favicon"
      : `/admin/settings/favicon/${variant}`;
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    redirectToLoginOnUnauthorized(response.status, path);
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join("；")
      : body?.message;
    throw new ApiError(message ?? "网站图标上传失败", response.status);
  }

  return (await response.json()) as { settings: SystemSettings };
}

export function resetSystemFavicon(variant: FaviconVariant = "default") {
  const path =
    variant === "default"
      ? "/admin/settings/favicon"
      : `/admin/settings/favicon/${variant}`;
  return request<{ settings: SystemSettings }>(path, { method: "DELETE" });
}

export interface HttpsStatus {
  available: boolean;
  /** Vercel 下为 "vercel"，表示由 Vercel 项目设置托管。 */
  managedBy?: "vercel";
  message?: string;
  enabled: boolean;
  domain: string | null;
  subjectType: "domain" | "ip" | null;
  challengeType: "http-01" | "tls-alpn-01" | null;
  certificateProfile: "shortlived" | null;
  autoRenewEnabled: boolean;
  httpHost: string | null;
  httpPrimaryHost: string | null;
  httpAllowedHosts: string[];
  expiresAt: string | null;
  lastRenewedAt: string | null;
  lastRenewalCheckAt: string | null;
  lastError: string | null;
}

export function getHttpsStatus() {
  return request<{ https: HttpsStatus }>("/admin/settings/https");
}

export function enableHttps(input: { domain: string; email: string }) {
  return request<{ https: HttpsStatus }>("/admin/settings/https/enable", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function disableHttps(input: { httpHost?: string } = {}) {
  return request<{ https: HttpsStatus }>("/admin/settings/https/disable", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function configureHttpAccess(input: {
  primaryHost: string;
  allowedHosts: string[];
}) {
  return request<{ https: HttpsStatus }>("/admin/settings/https/http-access", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function setHttpsAutoRenew(enabled: boolean) {
  return request<{ https: HttpsStatus }>("/admin/settings/https/auto-renew", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export interface StorageSettings {
  backend: "minio" | "oss" | "r2";
  downloadMode: "proxy" | "direct";
  uploadMode: "relay" | "direct";
  /** Vercel 下为 "environment"，表示由环境变量管理，不可编辑。 */
  source?: "environment";
  editable?: boolean;
  /** Vercel R2 的只读 Bucket 名称。 */
  bucket?: string;
  minio: { endpoint: string; bucket: string };
  oss: {
    region: string | null;
    bucket: string | null;
    endpoint: string | null;
    internal: boolean;
    internalEndpoint: string | null;
    accessKeyId: string | null;
    secretConfigured: boolean;
  };
  activeBackendHealthy: boolean;
  fileDistribution: {
    minio: { count: number; bytes: number };
    oss: { count: number; bytes: number };
    r2: { count: number; bytes: number };
  };
  updatedAt: string | null;
}

export interface OssSettingsInput {
  region?: string;
  bucket?: string;
  endpoint?: string;
  internal?: boolean;
  /** 自定义内网 Endpoint;留空用阿里云默认内网域名 */
  internalEndpoint?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
}

export function getStorageSettings() {
  return request<{ storage: StorageSettings }>("/admin/settings/storage");
}

export function updateStorageSettings(input: {
  backend?: "minio" | "oss";
  downloadMode?: "proxy" | "direct";
  uploadMode?: "relay" | "direct";
  oss?: OssSettingsInput;
}) {
  return request<{ storage: StorageSettings }>("/admin/settings/storage", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function testStorageConnection(input: OssSettingsInput) {
  return request<{ ok: boolean }>("/admin/settings/storage/test", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getServerStatus(hours = 24) {
  return request<ServerStatusSummary>(
    `/admin/server-status?hours=${encodeURIComponent(hours)}`,
  );
}

export type AiProviderConfig = AiProviderConfigSummary;

export type AiSettings = AiSettingsSummary;

export function getAiSettings() {
  return request<{ settings: AiSettings }>("/admin/ai/settings");
}

export function updateAiSettings(
  input: Partial<{
    enabled: boolean;
    maxContextFiles: number;
    maxContextChars: number;
    defaultCallLimit: number;
  }>,
) {
  return request<{ settings: AiSettings }>("/admin/ai/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface AiProviderConfigInput {
  name: string;
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export function createAiProviderConfig(
  input: AiProviderConfigInput & { apiKey: string },
) {
  return request<{ config: AiProviderConfig }>("/admin/ai/configs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAiProviderConfig(
  configId: string,
  input: AiProviderConfigInput,
) {
  return request<{ config: AiProviderConfig }>(
    `/admin/ai/configs/${configId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function activateAiProviderConfig(configId: string) {
  return request<{ settings: AiSettings }>(
    `/admin/ai/configs/${configId}/activate`,
    { method: "POST" },
  );
}

export function deleteAiProviderConfig(configId: string) {
  return request<{ ok: true }>(`/admin/ai/configs/${configId}`, {
    method: "DELETE",
  });
}

export interface AiSourceSummary {
  id: string;
  title: string;
  type: string;
  updatedAt: string;
  unavailable?: boolean;
  blocks?: Array<{
    id: string;
    type: string;
    text: string;
  }>;
}

export interface AiMessageSummary {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AiSourceSummary[];
  createdAt: string;
}

export interface AiConversationSummary {
  id: string;
  title: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string;
}

export interface AiConversationDetail extends AiConversationSummary {
  messages: AiMessageSummary[];
}

export interface AiStatus {
  available: boolean;
  enabled: boolean;
  configured: boolean;
  reason: string | null;
}

export function getAiStatus() {
  return request<{ status: AiStatus }>("/ai/status");
}

export async function getAiUsage(): Promise<AiUsageSummary> {
  const result = await request<{ usage: AiUsageSummary }>("/ai/usage");
  return result.usage;
}

export const AI_USAGE_CONSUMED_EVENT = "liveboard:ai-usage-consumed";

export function listAiConversations() {
  return request<{ conversations: AiConversationSummary[] }>(
    "/ai/conversations",
  );
}

export function getAiConversation(conversationId: string) {
  return request<{ conversation: AiConversationDetail }>(
    `/ai/conversations/${conversationId}`,
  );
}

export function deleteAiConversation(conversationId: string) {
  return request<{ ok: boolean }>(`/ai/conversations/${conversationId}`, {
    method: "DELETE",
  });
}

export function updateAiConversation(
  conversationId: string,
  input: { title?: string; pinned?: boolean },
) {
  return request<{ conversation: AiConversationSummary }>(
    `/ai/conversations/${conversationId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function askAi(input: { message: string; conversationId?: string }) {
  return request<{ answer: string; sources: AiSourceSummary[] }>("/ai/ask", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listForumOverview() {
  return request<{
    categories: ForumCategorySummary[];
    threads: ForumThreadSummary[];
  }>("/forum/overview");
}

export function listForumCategories() {
  return request<{ categories: ForumCategorySummary[] }>("/forum/categories");
}

export function createForumCategory(input: {
  name: string;
  description?: string;
  sortOrder?: number;
}) {
  return request<{ category: ForumCategorySummary }>("/forum/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateForumCategory(
  categoryId: string,
  input: { name?: string; description?: string; sortOrder?: number },
) {
  return request<{ category: ForumCategorySummary }>(
    `/forum/categories/${categoryId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function deleteForumCategory(categoryId: string) {
  return request<{ ok: boolean }>(`/forum/categories/${categoryId}`, {
    method: "DELETE",
  });
}

export function getForumThread(threadId: string) {
  return request<{ thread: ForumThreadDetail }>(`/forum/threads/${threadId}`);
}

export function createForumThread(input: {
  categoryId: string;
  title: string;
  body: string;
  isAnonymous?: boolean;
  relatedResources?: Array<{
    type: "document" | "teaching" | "exercise";
    id: string;
  }>;
}) {
  return request<{ thread: ForumThreadDetail }>("/forum/threads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateForumThread(
  threadId: string,
  input: {
    title?: string;
    categoryId?: string;
    status?: ForumThreadStatus;
  },
) {
  return request<{ thread: ForumThreadDetail }>(`/forum/threads/${threadId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteForumThread(threadId: string) {
  return request<{ ok: boolean }>(`/forum/threads/${threadId}`, {
    method: "DELETE",
  });
}

export function createForumPost(
  threadId: string,
  input: { body: string; parentId?: string; isAnonymous?: boolean },
) {
  return request<{ post: ForumPostSummary }>(
    `/forum/threads/${threadId}/posts`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function uploadForumPostImages(postId: string, images: File[]) {
  const formData = new FormData();
  for (const image of images) {
    formData.append("images", image);
  }

  const response = await fetch(`${API_URL}/forum/posts/${postId}/images`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    redirectToLoginOnUnauthorized(
      response.status,
      `/forum/posts/${postId}/images`,
    );
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new ApiError(body?.message ?? "图片上传失败", response.status);
  }

  return (await response.json()) as { images: ForumImageSummary[] };
}

function abortForumPostImageUpload(postId: string, uploadId: string) {
  return request<{ ok: boolean }>(
    `/forum/posts/${postId}/images/upload-abort`,
    {
      method: "POST",
      body: JSON.stringify({ uploadId }),
    },
  ).catch(() => undefined);
}

/**
 * 单张论坛图片直传：签名 → 直传对象存储（OSS/R2）→ 确认。
 * Vercel 下图片直传失败直接抛出，不允许回退 multipart。
 */
export async function uploadForumPostImageDirect(
  postId: string,
  file: File,
  options?: UploadRequestOptions,
) {
  let signed: SignedUploadResponse;
  try {
    signed = await request<SignedUploadResponse>(
      `/forum/posts/${postId}/images/upload-url`,
      {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          sizeBytes: file.size,
          mimeType: file.type || undefined,
        }),
      },
    );
  } catch (caught) {
    if (
      ALLOW_RELAY_FALLBACK &&
      caught instanceof ApiError &&
      caught.status === 501
    ) {
      const { images } = await uploadForumPostImages(postId, [file]);
      return { image: images[0]! };
    }
    throw caught;
  }

  try {
    await uploadToObjectStorage(
      signed.instruction,
      signed.uploadId,
      file,
      options,
    );
  } catch (caught) {
    await abortForumPostImageUpload(postId, signed.uploadId);
    if (isAbortError(caught)) throw caught;
    if (ALLOW_RELAY_FALLBACK) {
      const { images } = await uploadForumPostImages(postId, [file]);
      return { image: images[0]! };
    }
    throw caught;
  }

  return request<{ image: ForumImageSummary }>(
    `/forum/posts/${postId}/images/upload-confirm`,
    {
      method: "POST",
      body: JSON.stringify({ uploadId: signed.uploadId }),
    },
  );
}

export function voteForumPost(postId: string, vote: "up" | "down") {
  return request<{
    postId: string;
    upvoteCount: number;
    downvoteCount: number;
    viewerVote: "up" | "down" | null;
  }>(`/forum/posts/${postId}/vote`, {
    method: "PUT",
    body: JSON.stringify({ vote }),
  });
}

export function deleteForumPost(postId: string) {
  return request<{
    ok: boolean;
    deletedThread?: boolean;
    deletedCount?: number;
  }>(`/forum/posts/${postId}`, {
    method: "DELETE",
  });
}

export async function askAiStream(
  input: { message: string; conversationId?: string },
  handlers: {
    onConversation?: (payload: {
      conversation: AiConversationSummary;
      userMessage: AiMessageSummary;
    }) => void;
    onSources?: (sources: AiSourceSummary[]) => void;
    onDelta: (delta: string) => void;
    onMessage?: (message: AiMessageSummary) => void;
  },
  signal?: AbortSignal,
) {
  const response = await fetch(`${API_URL}/ai/ask/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok) {
    redirectToLoginOnUnauthorized(response.status, "/ai/ask/stream");
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new ApiError(body?.message ?? "AI 请求失败", response.status);
  }

  window.dispatchEvent(new Event(AI_USAGE_CONSUMED_EVENT));

  if (!response.body) {
    throw new ApiError("浏览器不支持流式响应", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      handleAiStreamLine(line, handlers);
    }
  }

  if (buffer.trim()) {
    handleAiStreamLine(buffer, handlers);
  }
}

function handleAiStreamLine(
  line: string,
  handlers: {
    onConversation?: (payload: {
      conversation: AiConversationSummary;
      userMessage: AiMessageSummary;
    }) => void;
    onSources?: (sources: AiSourceSummary[]) => void;
    onDelta: (delta: string) => void;
    onMessage?: (message: AiMessageSummary) => void;
  },
) {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  const event = JSON.parse(trimmed) as
    | {
        type: "conversation";
        conversation: AiConversationSummary;
        userMessage: AiMessageSummary;
      }
    | { type: "sources"; sources: AiSourceSummary[] }
    | { type: "delta"; delta: string }
    | { type: "message"; message: AiMessageSummary }
    | { type: "error"; message: string }
    | { type: "done" };

  if (event.type === "conversation") {
    handlers.onConversation?.({
      conversation: event.conversation,
      userMessage: event.userMessage,
    });
    return;
  }

  if (event.type === "sources") {
    handlers.onSources?.(event.sources);
    return;
  }

  if (event.type === "delta") {
    handlers.onDelta(event.delta);
    return;
  }

  if (event.type === "message") {
    handlers.onMessage?.(event.message);
    return;
  }

  if (event.type === "error") {
    throw new ApiError(event.message, 502);
  }
}

export function getFolderTree() {
  return request<{ folders: FolderNode[]; canManagePins: boolean }>(
    "/folders/tree",
  );
}

export function updateContentPins(folderId: string, items: ContentPinTarget[]) {
  return request<{ folders: FolderNode[]; canManagePins: boolean }>(
    "/content-pins",
    {
      method: "PATCH",
      body: JSON.stringify({ folderId, items }),
    },
  );
}

export function createFolder(input: { name: string; parentId?: string }) {
  return request<{ folder: { id: string; name: string } }>("/folders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFolder(input: {
  folderId: string;
  name?: string;
  parentId?: string | null;
}) {
  return request<{ folder: { id: string; name: string } }>(
    `/folders/${input.folderId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      }),
    },
  );
}

export function deleteFolder(folderId: string, confirmationName: string) {
  return request<{ ok: boolean }>(`/folders/${folderId}`, {
    method: "DELETE",
    body: JSON.stringify({ recursive: true, confirmationName }),
  });
}

export function listFiles(folderId?: string) {
  const search = new URLSearchParams();

  if (folderId) {
    search.set("folderId", folderId);
  }

  const query = search.toString() ? `?${search.toString()}` : "";
  return request<{
    files: FileSummary[];
    standaloneAssets: FolderAssetSummary[];
  }>(`/files${query}`);
}

export function renameAsset(assetId: string, filename: string) {
  return request<{
    asset: { id: string; filename: string; updatedAt: string };
  }>(`/assets/${assetId}`, {
    method: "PATCH",
    body: JSON.stringify({ filename }),
  });
}

export interface FileDetail extends FileSummary {
  permission: PermissionLevel;
  version: number;
  importWarnings?: string[] | null;
}

export interface ContentBlock {
  id: string;
  fileId: string;
  type: ContentBlockType;
  sortOrder: number;
  dataJson: { text?: string; language?: string } | unknown;
}

export function getFile(id: string) {
  return request<{ file: FileDetail }>(`/files/${id}`);
}

export function listBlocks(fileId: string) {
  return request<{ blocks: ContentBlock[] }>(`/files/${fileId}/blocks`);
}

export function createBlock(input: {
  fileId: string;
  type: ContentBlockType;
  dataJson: unknown;
  afterBlockId?: string;
}) {
  return request<{ block: ContentBlock }>(`/files/${input.fileId}/blocks`, {
    method: "POST",
    body: JSON.stringify({
      type: input.type,
      dataJson: input.dataJson,
      ...(input.afterBlockId ? { afterBlockId: input.afterBlockId } : {}),
    }),
  });
}

export interface FileAssetSummary {
  id: string;
  folderId: string | null;
  fileId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  referenceCount?: number;
  createdAt?: string;
  uploader?: UserSummary;
}

export type AssetReferenceSummary =
  | {
      targetType: "file";
      fileId: string;
      fileTitle: string;
      blockId: string;
      blockType: string;
    }
  | {
      targetType: "teaching_deck";
      deckId: string;
      deckTitle: string;
      itemId: string;
    };

export class AssetInUseError extends ApiError {
  constructor(
    message: string,
    readonly references: AssetReferenceSummary[],
  ) {
    super(message, 409);
  }
}

export async function uploadAsset(
  input: {
    file: File;
    fileId?: string;
    folderId?: string;
  },
  options?: UploadRequestOptions,
) {
  const formData = new FormData();
  formData.set("file", input.file);

  if (input.fileId) {
    formData.set("fileId", input.fileId);
  }

  if (input.folderId) {
    formData.set("folderId", input.folderId);
  }

  return uploadFormData<{ asset: FileAssetSummary }>(
    "/assets/upload",
    formData,
    "文件上传失败",
    options,
  );
}

function isAbortError(caught: unknown) {
  return caught instanceof DOMException && caught.name === "AbortError";
}

function abortAssetUpload(uploadId: string) {
  return request<{ ok: boolean }>("/assets/upload-abort", {
    method: "POST",
    body: JSON.stringify({ uploadId }),
  }).catch(() => undefined);
}

/**
 * 签名直入(浏览器直传 OSS/R2):按服务端返回的上传指令直传对象存储。
 * 自托管下签名 501 或直传失败(多为 Bucket 未配 CORS)时回退服务器中转；
 * Vercel 下禁止回退，直传失败直接抛出。配额/重名/权限等校验错误直接抛出。
 */
export async function uploadAssetDirect(
  input: {
    file: File;
    fileId?: string;
    folderId?: string;
  },
  options?: UploadRequestOptions,
) {
  let signed: SignedUploadResponse;
  try {
    signed = await request<SignedUploadResponse>("/assets/upload-url", {
      method: "POST",
      body: JSON.stringify({
        filename: input.file.name,
        sizeBytes: input.file.size,
        mimeType: input.file.type || undefined,
        fileId: input.fileId,
        folderId: input.folderId,
      }),
    });
  } catch (caught) {
    if (
      ALLOW_RELAY_FALLBACK &&
      caught instanceof ApiError &&
      caught.status === 501
    ) {
      return uploadAsset(input, options);
    }
    throw caught;
  }

  try {
    await uploadToObjectStorage(
      signed.instruction,
      signed.uploadId,
      input.file,
      options,
    );
  } catch (caught) {
    await abortAssetUpload(signed.uploadId);
    if (isAbortError(caught)) throw caught;
    if (ALLOW_RELAY_FALLBACK) return uploadAsset(input, options);
    throw caught;
  }

  return request<{ asset: FileAssetSummary }>("/assets/upload-confirm", {
    method: "POST",
    body: JSON.stringify({ uploadId: signed.uploadId }),
  });
}

export function listLibraryAssets() {
  return request<{ assets: FileAssetSummary[] }>("/assets/library");
}

export function listAssetReferences(assetId: string) {
  return request<{ references: AssetReferenceSummary[] }>(
    `/assets/${assetId}/references`,
  );
}

export async function deleteLibraryAsset(assetId: string) {
  const response = await fetch(`${API_URL}/assets/${assetId}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    redirectToLoginOnUnauthorized(response.status, `/assets/${assetId}`);
    const body = (await response.json().catch(() => null)) as {
      message?:
        string | { message?: string; references?: AssetReferenceSummary[] };
      references?: AssetReferenceSummary[];
    } | null;
    const messageValue = body?.message;
    const message =
      typeof messageValue === "string"
        ? messageValue
        : (messageValue?.message ?? "Delete failed");
    const references =
      body?.references ??
      (typeof messageValue === "object" ? messageValue.references : []);

    if (response.status === 409) {
      throw new AssetInUseError(message, references ?? []);
    }

    throw new ApiError(message, response.status);
  }

  return (await response.json()) as { ok: boolean };
}

export function reorderBlocks(input: { fileId: string; blockIds: string[] }) {
  return request<{ blocks: ContentBlock[] }>(
    `/files/${input.fileId}/blocks/reorder`,
    {
      method: "PATCH",
      body: JSON.stringify({ blockIds: input.blockIds }),
    },
  );
}

export function updateBlock(input: {
  blockId: string;
  type?: ContentBlockType;
  dataJson: unknown;
}) {
  return request<{ block: ContentBlock }>(`/blocks/${input.blockId}`, {
    method: "PATCH",
    body: JSON.stringify({ type: input.type, dataJson: input.dataJson }),
  });
}

export function deleteBlock(blockId: string) {
  return request<{ ok: boolean }>(`/blocks/${blockId}`, {
    method: "DELETE",
  });
}

export function publishFile(fileId: string) {
  return request<{ file: FileDetail }>(`/files/${fileId}/publish`, {
    method: "POST",
  });
}

export function deleteFile(fileId: string) {
  return request<{ ok: boolean }>(`/files/${fileId}`, {
    method: "DELETE",
  });
}

export function dismissImportWarnings(fileId: string) {
  return request<{ ok: boolean }>(`/files/${fileId}/import-warnings`, {
    method: "DELETE",
  });
}

export function updateFile(input: {
  fileId: string;
  title?: string;
  folderId?: string;
}) {
  return request<{ file: FileDetail }>(`/files/${input.fileId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(input.title ? { title: input.title } : {}),
      ...(input.folderId ? { folderId: input.folderId } : {}),
    }),
  });
}

export function createFile(input: { folderId: string; title: string }) {
  return request<{ file: FileSummary }>("/files", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface MarkdownImportResult {
  file: FileSummary;
  warnings: string[];
  blockCount: number;
}

export async function importMarkdown(input: { folderId: string; file: File }) {
  const formData = new FormData();
  formData.set("folderId", input.folderId);
  formData.set("file", input.file);

  const response = await fetch(`${API_URL}/files/import/markdown`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!response.ok) {
    redirectToLoginOnUnauthorized(response.status, "/files/import/markdown");
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join("；")
      : body?.message;
    throw new ApiError(message ?? "导入 Markdown 失败", response.status);
  }

  return (await response.json()) as MarkdownImportResult;
}

export async function downloadMarkdown(fileId: string) {
  const path = `/files/${fileId}/export/markdown`;
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
  });
  if (!response.ok) {
    redirectToLoginOnUnauthorized(response.status, path);
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join("；")
      : body?.message;
    throw new ApiError(message ?? "导出 Markdown 失败", response.status);
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let filename = "content.md";
  if (encodedFilename) {
    try {
      filename = decodeURIComponent(encodedFilename);
    } catch {
      filename = "content.md";
    }
  }

  return { blob: await response.blob(), filename };
}

export interface ClassroomDetail extends ClassroomSummary {
  canManageMembers: boolean;
  canEditContent: boolean;
  canEditClassroom: boolean;
  members?: ClassroomMemberSummary[];
  announcements: ClassroomAnnouncementSummary[];
}

export interface ClassroomFileSummary {
  id: string;
  classroomId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: UserSummary;
  createdAt: string;
  url: string;
}

export function listClassrooms() {
  return request<{ classrooms: ClassroomSummary[] }>("/classrooms");
}

export function getClassroom(classroomId: string) {
  return request<{ classroom: ClassroomDetail }>(`/classrooms/${classroomId}`);
}

export function createClassroom(input: {
  name: string;
  description?: string;
  teacherUserIds: string[];
  studentUserIds?: string[];
}) {
  return request<{ classroom: ClassroomDetail }>("/classrooms", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateClassroom(
  classroomId: string,
  input: {
    name?: string;
    description?: string;
    storageQuotaBytes?: number | null;
  },
) {
  return request<{ classroom: ClassroomDetail }>(`/classrooms/${classroomId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteClassroom(classroomId: string) {
  return request<{ ok: boolean }>(`/classrooms/${classroomId}`, {
    method: "DELETE",
  });
}

export function upsertClassroomMember(
  classroomId: string,
  userId: string,
  role: ClassroomMemberRole,
) {
  return request<{ classroom: ClassroomDetail }>(
    `/classrooms/${classroomId}/members/${userId}`,
    { method: "PUT", body: JSON.stringify({ role }) },
  );
}

export function removeClassroomMember(classroomId: string, userId: string) {
  return request<{ classroom: ClassroomDetail }>(
    `/classrooms/${classroomId}/members/${userId}`,
    { method: "DELETE" },
  );
}

export function createClassroomAnnouncement(
  classroomId: string,
  input: { title: string; content: string },
) {
  return request<{ announcement: ClassroomAnnouncementSummary }>(
    `/classrooms/${classroomId}/announcements`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateClassroomAnnouncement(
  classroomId: string,
  announcementId: string,
  input: { title?: string; content?: string },
) {
  return request<{ announcement: ClassroomAnnouncementSummary }>(
    `/classrooms/${classroomId}/announcements/${announcementId}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteClassroomAnnouncement(
  classroomId: string,
  announcementId: string,
) {
  return request<{ ok: boolean }>(
    `/classrooms/${classroomId}/announcements/${announcementId}`,
    { method: "DELETE" },
  );
}

export function listClassroomFiles(classroomId: string) {
  return request<{ files: ClassroomFileSummary[] }>(
    `/classrooms/${classroomId}/files`,
  );
}

export async function uploadClassroomFile(
  classroomId: string,
  file: File,
  options?: UploadRequestOptions,
) {
  const path = `/classrooms/${classroomId}/files`;
  const formData = new FormData();
  formData.set("file", file);
  return uploadFormData<{ file: ClassroomFileSummary }>(
    path,
    formData,
    "上传课堂文件失败",
    options,
  );
}

/**
 * 课堂文件的签名直入版本，回退策略同 uploadAssetDirect。
 */
export async function uploadClassroomFileDirect(
  classroomId: string,
  file: File,
  options?: UploadRequestOptions,
) {
  const base = `/classrooms/${classroomId}/files`;
  let signed: SignedUploadResponse;
  try {
    signed = await request<SignedUploadResponse>(`${base}/upload-url`, {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        sizeBytes: file.size,
        mimeType: file.type || undefined,
      }),
    });
  } catch (caught) {
    if (
      ALLOW_RELAY_FALLBACK &&
      caught instanceof ApiError &&
      caught.status === 501
    ) {
      return uploadClassroomFile(classroomId, file, options);
    }
    throw caught;
  }

  try {
    await uploadToObjectStorage(
      signed.instruction,
      signed.uploadId,
      file,
      options,
    );
  } catch (caught) {
    await request<{ ok: boolean }>(`${base}/upload-abort`, {
      method: "POST",
      body: JSON.stringify({ uploadId: signed.uploadId }),
    }).catch(() => undefined);
    if (isAbortError(caught)) throw caught;
    if (ALLOW_RELAY_FALLBACK)
      return uploadClassroomFile(classroomId, file, options);
    throw caught;
  }

  return request<{ file: ClassroomFileSummary }>(`${base}/upload-confirm`, {
    method: "POST",
    body: JSON.stringify({ uploadId: signed.uploadId }),
  });
}

export function deleteClassroomFile(classroomId: string, fileId: string) {
  return request<{ ok: boolean }>(
    `/classrooms/${classroomId}/files/${fileId}`,
    { method: "DELETE" },
  );
}

export interface TeachingDeckItemInput {
  type: TeachingDeckItemType;
  sourceBlockId?: string;
  exerciseSetId?: string;
  imageFit?: "fit" | "fill" | "original";
}

export interface TeachingDeckItem {
  id: string;
  type: TeachingDeckItemType;
  sortOrder: number;
  sourceFileId: string | null;
  sourceBlockId: string | null;
  sourceFileTitle: string | null;
  block: ContentBlock | null;
  exerciseSetId: string | null;
  exerciseTitle: string | null;
}

export interface TeachingDeckDetail {
  id: string;
  classroomId: string;
  classroomName: string;
  title: string;
  createdBy: UserSummary;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
  items: TeachingDeckItem[];
}

export function listTeachingDecks(classroomId?: string) {
  const query = classroomId
    ? `?classroomId=${encodeURIComponent(classroomId)}`
    : "";
  return request<{ decks: TeachingDeckSummary[] }>(`/teaching-decks${query}`);
}

export function getTeachingDeck(id: string) {
  return request<{ deck: TeachingDeckDetail }>(`/teaching-decks/${id}`);
}

export function createTeachingDeck(input: {
  classroomId: string;
  title: string;
  items: TeachingDeckItemInput[];
}) {
  return request<{ deck: TeachingDeckDetail }>("/teaching-decks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTeachingDeck(
  id: string,
  input: {
    title?: string;
    items?: TeachingDeckItemInput[];
  },
) {
  return request<{ deck: TeachingDeckDetail }>(`/teaching-decks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteTeachingDeck(id: string) {
  return request<{ ok: boolean }>(`/teaching-decks/${id}`, {
    method: "DELETE",
  });
}

export interface ExerciseSetSummary {
  id: string;
  classroomId: string;
  classroomName: string;
  /** 历史关联的 exercise_set 文件，新建练习不再创建，可为空。 */
  fileId: string | null;
  title: string;
  createdBy: UserSummary;
  questionCount: number;
  canManage: boolean;
  /** 仅最高管理员可见：当前用户既非创建者也不在可见范围内。 */
  viaSuperAdmin?: boolean;
  submissionCount: number;
  pendingReviewCount: number;
  openAt: string | null;
  dueAt: string | null;
  updatedAt: string;
  latestSubmissionStatus: string;
  latestScore: number | null;
  maxScore: number | null;
}

export function listExerciseSets(classroomId?: string) {
  const query = classroomId
    ? `?classroomId=${encodeURIComponent(classroomId)}`
    : "";
  return request<{ exerciseSets: ExerciseSetSummary[] }>(
    `/exercise-sets${query}`,
  );
}

export interface CreateExerciseQuestionInput {
  type: QuestionType;
  promptJson: { text: string };
  optionsJson?: { options: string[] };
  answerJson?: unknown;
  score: number;
  required?: boolean;
}

export function createExerciseSet(input: {
  classroomId: string;
  title: string;
  openAt?: string;
  dueAt?: string;
  allowMultipleSubmissions: boolean;
  showAnswerAfterSubmit: boolean;
  questions: CreateExerciseQuestionInput[];
}) {
  return request<{ exerciseSet: { id: string; fileId: string } }>(
    "/exercise-sets",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function updateExerciseSet(
  id: string,
  input: {
    title: string;
    openAt?: string;
    dueAt?: string;
    allowMultipleSubmissions: boolean;
    showAnswerAfterSubmit: boolean;
    questions: CreateExerciseQuestionInput[];
  },
) {
  return request<{ exerciseSet: { id: string; classroomId: string } }>(
    `/exercise-sets/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export interface ExerciseQuestion {
  id: string;
  exerciseSetId: string;
  type:
    | "single_choice"
    | "multiple_choice"
    | "true_false"
    | "fill_blank"
    | "short_answer";
  promptJson: { text?: string } | unknown;
  optionsJson?: { options?: string[] } | unknown;
  answerJson?: unknown;
  score: number;
  required?: boolean;
  sortOrder: number;
}

export interface ExerciseSetDetail {
  id: string;
  classroomId: string;
  classroomName: string;
  title: string;
  createdById: string;
  /** 历史关联的 exercise_set 文件，可为空。 */
  fileId: string | null;
  openAt: string | null;
  dueAt: string | null;
  allowMultipleSubmissions: boolean;
  showAnswerAfterSubmit: boolean;
  questions: ExerciseQuestion[];
  canManage: boolean;
}

export function getExerciseSet(id: string) {
  return request<{ exerciseSet: ExerciseSetDetail }>(`/exercise-sets/${id}`);
}

export function submitExerciseSet(
  id: string,
  answers: Array<{ questionId: string; answerJson: unknown }>,
) {
  return request<{
    submission: {
      id: string;
      status: string;
      score: number | null;
      maxScore: number;
      answers: Array<{ id: string; questionId: string; score: number | null }>;
    };
  }>(`/exercise-sets/${id}/submit`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export interface SubmissionAnswerSummary {
  id: string;
  questionId: string;
  answerJson: unknown;
  score: number | null;
  feedback: string | null;
  autoGraded: boolean;
  question?: {
    id: string;
    type: QuestionType;
    promptJson: { text?: string } | unknown;
    optionsJson?: { options?: string[] } | unknown;
    answerJson?: unknown;
    score: number;
    sortOrder: number;
  };
}

export interface SubmissionSummary {
  id: string;
  status: string;
  score: number | null;
  maxScore: number;
  submittedAt: string | null;
  feedback: string | null;
  user: UserSummary;
  answers: SubmissionAnswerSummary[];
}

export function listSubmissions(exerciseSetId: string) {
  return request<{ submissions: SubmissionSummary[] }>(
    `/exercise-sets/${exerciseSetId}/submissions`,
  );
}

export function listMySubmissions(exerciseSetId: string) {
  return request<{ submissions: SubmissionSummary[] }>(
    `/exercise-sets/${exerciseSetId}/my-submissions`,
  );
}

export function gradeSubmission(
  submissionId: string,
  input: {
    feedback?: string;
    answers: Array<{ answerId: string; score: number; feedback?: string }>;
  },
) {
  return request<{ submission: SubmissionSummary }>(
    `/submissions/${submissionId}/grade`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}
