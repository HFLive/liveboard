import type {
  AiUsageSummary,
  AuthCapabilities,
  ClassroomAnnouncementSummary,
  ClassroomMemberSummary,
  ClassroomSummary,
  ContentBlockType,
  FileSummary,
  FolderAssetSummary,
  FolderNode,
  ForumCategorySummary,
  ForumImageSummary,
  ForumPostSummary,
  ForumThreadDetail,
  ForumThreadSummary,
  PermissionLevel,
  QuestionType,
  SignedUploadResponse,
  TeachingDeckSummary,
  UserProfile,
  UserSummary,
} from "@liveboard/shared";

export interface ContentBlock {
  id: string;
  fileId: string;
  type: ContentBlockType;
  sortOrder: number;
  dataJson: unknown;
}

export interface FileDetail extends FileSummary {
  permission: PermissionLevel;
  version: number;
  importWarnings?: string[] | null;
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

export interface TeachingDeckItem {
  id: string;
  type: "content_block" | "exercise";
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

export interface ExerciseSetSummary {
  id: string;
  classroomId: string;
  classroomName: string;
  fileId: string | null;
  title: string;
  createdBy: UserSummary;
  questionCount: number;
  canManage: boolean;
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

export interface ExerciseQuestion {
  id: string;
  exerciseSetId: string;
  type: QuestionType;
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
  fileId: string | null;
  openAt: string | null;
  dueAt: string | null;
  allowMultipleSubmissions: boolean;
  showAnswerAfterSubmit: boolean;
  questions: ExerciseQuestion[];
  canManage: boolean;
}

export interface AiSourceSummary {
  id: string;
  title: string;
  type: string;
  updatedAt: string;
  unavailable?: boolean;
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

export interface LocalUploadFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export type {
  AiUsageSummary,
  AuthCapabilities,
  ClassroomAnnouncementSummary,
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
  PermissionLevel,
  SignedUploadResponse,
  TeachingDeckSummary,
  UserProfile,
  UserSummary,
};
