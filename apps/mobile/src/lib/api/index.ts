import type {
  AuthCapabilities,
  FileSummary,
  FolderAssetSummary,
  FolderNode,
  ForumCategorySummary,
  ForumImageSummary,
  ForumPostSummary,
  ForumThreadDetail,
  ForumThreadSummary,
  TeachingDeckSummary,
  UserProfile,
  UserSummary,
} from "@liveboard/shared";
import { ApiError, apiUrl, authHeaders, request } from "./client";
import { consumeAiStream, type AiStreamHandlers } from "./stream";
import { uploadFormFile, uploadWithSignedProtocol } from "./upload";
import type {
  AiConversationDetail,
  AiConversationSummary,
  AiMessageSummary,
  AiSourceSummary,
  AiStatus,
  AiUsageSummary,
  ClassroomDetail,
  ClassroomFileSummary,
  ClassroomSummary,
  ContentBlock,
  ExerciseSetDetail,
  ExerciseSetSummary,
  FileDetail,
  LocalUploadFile,
  TeachingDeckDetail,
} from "./types";

export {
  ApiError,
  apiUrl,
  authHeaders,
  configureApiClient,
  requestBlob,
  setApiUnauthorizedHandler,
} from "./client";
export type * from "./types";

export function extractAssetPath(url: string): string | null {
  if (!url.startsWith("/") && !/^https?:\/\//i.test(url)) return null;
  let candidate = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      candidate = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  const match = candidate.match(
    /^\/(assets|auth\/avatar|auth\/banner|classrooms\/[^/]+\/files)\/[^/?#]+/,
  );
  return match ? match[0] : null;
}

export function resolveResourceUrl(url: string) {
  const assetPath = extractAssetPath(url);
  return assetPath
    ? apiUrl(assetPath)
    : url.startsWith("/")
      ? apiUrl(url)
      : url;
}

export function getAuthCapabilities() {
  return request<AuthCapabilities>("/auth/config");
}

export function login(username: string, password: string) {
  return request<{ user: UserSummary; sessionToken?: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function breakglassLogin(username: string, password: string) {
  return request<{ user: UserSummary; sessionToken?: string }>(
    "/auth/breakglass/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password }),
    },
  );
}

export function logout() {
  return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export function getMe() {
  return request<{ user: UserProfile }>("/auth/me");
}

export function listClassrooms() {
  return request<{ classrooms: ClassroomSummary[] }>("/classrooms");
}

export function getClassroom(classroomId: string) {
  return request<{ classroom: ClassroomDetail }>(`/classrooms/${classroomId}`);
}

export function listClassroomFiles(classroomId: string) {
  return request<{ files: ClassroomFileSummary[] }>(
    `/classrooms/${classroomId}/files`,
  );
}

export function uploadClassroomFile(
  classroomId: string,
  file: LocalUploadFile,
) {
  const base = `/classrooms/${classroomId}/files`;
  return uploadWithSignedProtocol<{ file: ClassroomFileSummary }>({
    signPath: `${base}/upload-url`,
    confirmPath: `${base}/upload-confirm`,
    abortPath: `${base}/upload-abort`,
    relayPath: base,
    file,
    signBody: {
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.mimeType || undefined,
    },
  });
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

export function listExerciseSets(classroomId?: string) {
  const query = classroomId
    ? `?classroomId=${encodeURIComponent(classroomId)}`
    : "";
  return request<{ exerciseSets: ExerciseSetSummary[] }>(
    `/exercise-sets${query}`,
  );
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
    };
  }>(`/exercise-sets/${id}/submit`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export function getFolderTree() {
  return request<{ folders: FolderNode[]; canManagePins: boolean }>(
    "/folders/tree",
  );
}

export function listFiles(folderId?: string) {
  const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
  return request<{
    files: FileSummary[];
    standaloneAssets: FolderAssetSummary[];
  }>(`/files${query}`);
}

export function getFile(id: string) {
  return request<{ file: FileDetail }>(`/files/${id}`);
}

export function listBlocks(fileId: string) {
  return request<{ blocks: ContentBlock[] }>(`/files/${fileId}/blocks`);
}

export function uploadStandaloneAsset(folderId: string, file: LocalUploadFile) {
  return uploadWithSignedProtocol<{
    asset: FolderAssetSummary;
  }>({
    signPath: "/assets/upload-url",
    confirmPath: "/assets/upload-confirm",
    abortPath: "/assets/upload-abort",
    relayPath: "/assets/upload",
    file,
    signBody: {
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.mimeType || undefined,
      folderId,
    },
    extraRelayFields: { folderId },
  });
}

export function listForumOverview() {
  return request<{
    categories: ForumCategorySummary[];
    threads: ForumThreadSummary[];
  }>("/forum/overview");
}

export function getForumThread(threadId: string) {
  return request<{ thread: ForumThreadDetail }>(`/forum/threads/${threadId}`);
}

export function createForumThread(input: {
  categoryId: string;
  title: string;
  body: string;
  isAnonymous?: boolean;
}) {
  return request<{ thread: ForumThreadDetail }>("/forum/threads", {
    method: "POST",
    body: JSON.stringify(input),
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

export function uploadForumPostImages(
  postId: string,
  images: LocalUploadFile[],
) {
  if (images.length === 1 && images[0]) {
    return uploadFormFile<{ images: ForumImageSummary[] }>(
      `/forum/posts/${postId}/images`,
      images[0],
      {},
      "images",
    );
  }
  return uploadFormFile<{ images: ForumImageSummary[] }>(
    `/forum/posts/${postId}/images`,
    images[0]!,
    {},
    "images",
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

export function getAiStatus() {
  return request<{ status: AiStatus }>("/ai/status");
}

export function getAiUsage() {
  return request<{ usage: AiUsageSummary }>("/ai/usage").then(
    (result) => result.usage,
  );
}

export function listAiConversations() {
  return request<{ conversations: AiConversationSummary[] }>(
    "/ai/conversations",
  );
}

export function getAiConversation(id: string) {
  return request<{ conversation: AiConversationDetail }>(
    `/ai/conversations/${id}`,
  );
}

export async function askAiStream(
  input: { message: string; conversationId?: string },
  handlers: AiStreamHandlers,
  signal?: AbortSignal,
) {
  const response = await fetch(apiUrl("/ai/ask/stream"), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      (body as { message?: string } | null)?.message ?? "AI 请求失败",
      response.status,
    );
  }

  if (response.body) {
    await consumeAiStream(response.body, handlers);
    return;
  }

  const fallback = await request<{
    answer: string;
    sources: AiSourceSummary[];
    conversation?: AiConversationSummary;
    userMessage?: AiMessageSummary;
    message?: AiMessageSummary;
  }>("/ai/ask", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
  if (fallback.conversation && fallback.userMessage) {
    handlers.onConversation?.({
      conversation: fallback.conversation,
      userMessage: fallback.userMessage,
    });
  }
  handlers.onSources?.(fallback.sources);
  handlers.onDelta(fallback.answer);
  if (fallback.message) {
    handlers.onMessage?.(fallback.message);
  }
}

export function fetchPreviewUrl(path: string) {
  return request<{ url: string | null }>(path);
}
