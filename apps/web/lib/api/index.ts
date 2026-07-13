import type {
  ContentBlockType,
  FileSummary,
  FolderNode,
  ForumCategorySummary,
  ForumPostSummary,
  ForumThreadDetail,
  ForumThreadSummary,
  ForumThreadStatus,
  PermissionGroupSummary,
  PermissionLevel,
  PermissionTargetType,
  QuestionType,
  SystemRole,
  TeachingDeckSummary,
  TeachingDeckItemType,
  UserSummary,
} from "@liveboard/shared";
import { API_URL, ApiError, request } from "./client";

export { ApiError } from "./client";

export function login(username: string, password: string) {
  return request<{ user: UserSummary }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return request<{ ok: boolean }>("/auth/logout", {
    method: "POST",
  });
}

export function getMe() {
  return request<{ user: UserSummary }>("/auth/me");
}

export function updateProfile(input: { displayName: string }) {
  return request<{ user: UserSummary }>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  return request<{ ok: boolean }>("/auth/password", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listUsers() {
  return request<{ users: UserSummary[] }>("/admin/users");
}

export function listPermissionGroups() {
  return request<{ groups: PermissionGroupSummary[] }>(
    "/admin/permission-groups",
  );
}

export function createPermissionGroup(input: {
  name: string;
  description?: string;
}) {
  return request<{ group: PermissionGroupSummary }>(
    "/admin/permission-groups",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function updatePermissionGroup(
  groupId: string,
  input: { name?: string; description?: string },
) {
  return request<{ group: PermissionGroupSummary }>(
    `/admin/permission-groups/${groupId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function deletePermissionGroup(groupId: string) {
  return request<{ ok: boolean }>(`/admin/permission-groups/${groupId}`, {
    method: "DELETE",
  });
}

export function addPermissionGroupMember(groupId: string, userId: string) {
  return request<{ group: PermissionGroupSummary }>(
    `/admin/permission-groups/${groupId}/members`,
    {
      method: "POST",
      body: JSON.stringify({ userId }),
    },
  );
}

export function removePermissionGroupMember(groupId: string, userId: string) {
  return request<{ group: PermissionGroupSummary }>(
    `/admin/permission-groups/${groupId}/members/${userId}`,
    { method: "DELETE" },
  );
}

export function listAssignablePermissionGroups(input: {
  targetType: PermissionTargetType;
  targetId: string;
}) {
  const search = new URLSearchParams(input);
  return request<{ groups: PermissionGroupSummary[] }>(
    `/permission-groups/assignable?${search.toString()}`,
  );
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
    storageQuotaBytes?: number;
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
  storageUsedBytes: number;
  assetCount: number;
}

export function listUserStorage() {
  return request<{ users: UserStorageSummary[] }>("/admin/users/storage");
}

export function updateUserStorageQuota(
  userId: string,
  storageQuotaBytes: number,
) {
  return updateUser(userId, { storageQuotaBytes });
}

export interface SystemSettings {
  workspaceName: string;
  workspaceSlug: string;
  timeZone: string;
  updatedAt: string;
}

export function getPublicSettings() {
  return request<{ settings: SystemSettings }>("/settings/public");
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

export interface AiProviderConfig {
  id: string;
  name: string;
  providerName: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiSettings {
  enabled: boolean;
  activeConfigId: string | null;
  activeConfig: AiProviderConfig | null;
  configs: AiProviderConfig[];
  maxContextFiles: number;
  maxContextChars: number;
  updatedAt: string;
}

export function getAiSettings() {
  return request<{ settings: AiSettings }>("/admin/ai/settings");
}

export function updateAiSettings(
  input: Partial<{
    enabled: boolean;
    maxContextFiles: number;
    maxContextChars: number;
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
  input: { body: string; parentId?: string },
) {
  return request<{ post: ForumPostSummary }>(
    `/forum/threads/${threadId}/posts`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function updateForumPost(postId: string, input: { body: string }) {
  return request<{ post: ForumPostSummary }>(`/forum/posts/${postId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteForumPost(postId: string) {
  return request<{
    ok: boolean;
    archivedThread?: boolean;
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
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new ApiError(body?.message ?? "AI 请求失败", response.status);
  }

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

export interface PermissionGrantSummary {
  id: string;
  targetType: PermissionTargetType;
  targetId: string;
  groupId?: string | null;
  level: PermissionLevel;
  group?: PermissionGroupSummary | null;
}

export function listPermissionGrants(
  targetType: PermissionTargetType,
  targetId: string,
) {
  const search = new URLSearchParams({ targetType, targetId });
  return request<{ grants: PermissionGrantSummary[] }>(
    `/permissions?${search.toString()}`,
  );
}

export function upsertPermissionGrant(input: {
  targetType: PermissionTargetType;
  targetId: string;
  groupId: string;
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

export function getFolderTree() {
  return request<{ folders: FolderNode[] }>("/folders/tree");
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

export function deleteFolder(folderId: string) {
  return request<{ ok: boolean }>(`/folders/${folderId}`, {
    method: "DELETE",
  });
}

export function listFiles(folderId?: string) {
  const search = new URLSearchParams();

  if (folderId) {
    search.set("folderId", folderId);
  }

  const query = search.toString() ? `?${search.toString()}` : "";
  return request<{ files: FileSummary[] }>(`/files${query}`);
}

export interface FileDetail extends FileSummary {
  permission: PermissionLevel;
  version: number;
}

export interface ContentBlock {
  id: string;
  fileId: string;
  type: ContentBlockType;
  sortOrder: number;
  dataJson: { text?: string; language?: string } | unknown;
  sourceFileId?: string | null;
  sourceBlockId?: string | null;
  referenceMode?: "snapshot" | "linked" | null;
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
}) {
  return request<{ block: ContentBlock }>(`/files/${input.fileId}/blocks`, {
    method: "POST",
    body: JSON.stringify({
      type: input.type,
      dataJson: input.dataJson,
    }),
  });
}

export function referenceBlocks(input: {
  fileId: string;
  sourceBlockIds: string[];
}) {
  return request<{ blocks: ContentBlock[] }>(
    `/files/${input.fileId}/reference-blocks`,
    {
      method: "POST",
      body: JSON.stringify({ sourceBlockIds: input.sourceBlockIds }),
    },
  );
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
}

export interface AssetReferenceSummary {
  fileId: string;
  fileTitle: string;
  blockId: string;
  blockType: string;
}

export class AssetInUseError extends ApiError {
  constructor(
    message: string,
    readonly references: AssetReferenceSummary[],
  ) {
    super(message, 409);
  }
}

export async function uploadAsset(input: {
  file: File;
  fileId?: string;
  folderId?: string;
}) {
  const formData = new FormData();
  formData.set("file", input.file);

  if (input.fileId) {
    formData.set("fileId", input.fileId);
  }

  if (input.folderId) {
    formData.set("folderId", input.folderId);
  }

  const response = await fetch(`${API_URL}/assets/upload`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new ApiError(body?.message ?? "Upload failed", response.status);
  }

  return (await response.json()) as { asset: FileAssetSummary };
}

export function listLibraryAssets() {
  return request<{ assets: FileAssetSummary[] }>("/assets/library");
}

export async function deleteLibraryAsset(assetId: string) {
  const response = await fetch(`${API_URL}/assets/${assetId}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
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

export function createFile(input: {
  folderId: string;
  title: string;
  type: FileSummary["type"];
}) {
  return request<{ file: FileSummary }>("/files", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface TeachingDeckItemInput {
  type: TeachingDeckItemType;
  sourceBlockId?: string;
  exerciseSetId?: string;
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
  title: string;
  createdBy: UserSummary;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
  items: TeachingDeckItem[];
}

export function listTeachingDecks() {
  return request<{ decks: TeachingDeckSummary[] }>("/teaching-decks");
}

export function getTeachingDeck(id: string) {
  return request<{ deck: TeachingDeckDetail }>(`/teaching-decks/${id}`);
}

export function createTeachingDeck(input: {
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
  input: { title?: string; items?: TeachingDeckItemInput[] },
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
  fileId: string;
  title: string;
  questionCount: number;
  canManage: boolean;
  submissionCount: number;
  pendingReviewCount: number;
  openAt: string | null;
  dueAt: string | null;
  updatedAt: string;
  latestSubmissionStatus: string;
  latestScore: number | null;
  maxScore: number | null;
}

export function listExerciseSets() {
  return request<{ exerciseSets: ExerciseSetSummary[] }>("/exercise-sets");
}

export interface CreateExerciseQuestionInput {
  type: QuestionType;
  promptJson: { text: string };
  optionsJson?: { options: string[] };
  answerJson?: unknown;
  score: number;
}

export function createExerciseSet(input: {
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
  sortOrder: number;
}

export interface ExerciseSetDetail {
  id: string;
  fileId: string;
  file: { title: string };
  openAt: string | null;
  dueAt: string | null;
  allowMultipleSubmissions: boolean;
  showAnswerAfterSubmit: boolean;
  questions: ExerciseQuestion[];
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
