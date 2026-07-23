export type SystemRole = "super_admin" | "admin" | "member";

export type PermissionLevel =
  "owner" | "editor" | "lecturer" | "viewer" | "no_access";

export type PermissionTargetType = "workspace" | "folder" | "file";

export type FileType =
  "book" | "lesson" | "course" | "exercise_set" | "doc" | "asset";

export type FileStatus = "draft" | "published" | "archived";

export type ContentBlockType =
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "heading_4"
  | "heading_5"
  | "heading_6"
  | "paragraph"
  | "bulleted_list"
  | "numbered_list"
  | "todo"
  | "code"
  | "quote"
  | "image"
  | "attachment"
  | "bilibili"
  | "divider"
  | "question"
  | "table"
  | "math";

export type QuestionType =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "fill_blank"
  | "short_answer";

export type SubmissionStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "auto_graded"
  | "needs_manual_review"
  | "graded"
  | "late";

export type ForumThreadStatus = "open" | "locked";

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  systemRole: SystemRole;
  status: "active" | "disabled";
}

export interface UserProfile extends UserSummary {
  bio: string | null;
  bannerUrl: string | null;
}

export interface UserPublicActivity {
  teachingDecks: Array<{
    id: string;
    title: string;
    itemCount: number;
    updatedAt: string;
  }>;
  forumThreads: Array<{
    id: string;
    title: string;
    categoryName: string;
    postCount: number;
    lastActivityAt: string;
  }>;
}

export type ActivityKind = "exercise" | "grading" | "document" | "forum";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  href: string;
  occurredAt: string;
  unread: boolean;
}

// 管理端用户列表专用：在 UserSummary 基础上附带 AI 调用配额信息
export interface AdminUserSummary extends UserSummary {
  aiCallCount: number;
  aiCallLimit: number | null;
}

export interface AiProviderConfigSummary {
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

export interface AiSettingsSummary {
  enabled: boolean;
  activeConfigId: string | null;
  activeConfig: AiProviderConfigSummary | null;
  configs: AiProviderConfigSummary[];
  maxContextFiles: number;
  maxContextChars: number;
  defaultCallLimit: number;
  updatedAt: string;
}

export interface AiUsageSummary {
  used: number;
  limit: number;
}

export interface ServerMetricPoint {
  sampledAt: string;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  diskUsagePercent: number;
}

export interface ServerResourceUsage {
  usagePercent: number;
  usedBytes: number;
  totalBytes: number;
}

export interface ServerStatusSummary {
  current: {
    sampledAt: string;
    cpuUsagePercent: number;
    memory: ServerResourceUsage;
    disk: ServerResourceUsage;
  };
  history: ServerMetricPoint[];
  sampleIntervalSeconds: number;
  retentionHours: number;
}

export interface PermissionGroupMemberSummary {
  id: string;
  user: UserSummary;
}

export interface PermissionGroupSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  members?: PermissionGroupMemberSummary[];
}

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  permission: PermissionLevel;
  fileCount: number;
  pinnedOrder: number | null;
  updatedAt: string;
  files: FileSummary[];
  children: FolderNode[];
}

export interface FileSummary {
  id: string;
  folderId: string;
  title: string;
  type: FileType;
  status: FileStatus;
  pinnedOrder: number | null;
  updatedAt: string;
}

export type ContentPinTargetType = "folder" | "file";

export interface ContentPinTarget {
  targetType: ContentPinTargetType;
  targetId: string;
}

export type TeachingDeckItemType = "content_block" | "exercise";

export interface TeachingDeckSummary {
  id: string;
  title: string;
  itemCount: number;
  createdBy: UserSummary;
  canEdit: boolean;
  /** 仅最高管理员可见：当前用户既非创建者也不在可见范围内。 */
  viaSuperAdmin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ForumCategorySummary {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  threadCount: number;
}

export interface ForumThreadSummary {
  id: string;
  categoryId: string;
  title: string;
  excerpt: string;
  status: ForumThreadStatus;
  isAnonymous: boolean;
  author: UserSummary;
  postCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  followed?: boolean;
  followRequired?: boolean;
  unread?: boolean;
  mentioned?: boolean;
  relatedResources?: ForumRelatedResource[];
}

export interface ForumRelatedResource {
  type: "document" | "teaching" | "exercise";
  id: string;
  title: string;
}

export interface ForumPostSummary {
  id: string;
  threadId: string;
  parentId: string | null;
  replyToId: string | null;
  replyTo?: {
    id: string;
    isAnonymous: boolean;
    author: UserSummary;
  } | null;
  isAnonymous: boolean;
  author: UserSummary;
  body: string;
  images: ForumImageSummary[];
  createdAt: string;
  updatedAt: string;
  upvoteCount: number;
  downvoteCount: number;
  viewerVote: "up" | "down" | null;
  canEdit?: boolean;
  canDelete?: boolean;
}

export interface ForumImageSummary {
  id: string;
  url: string;
  width: number;
  height: number;
  sortOrder: number;
}

export interface ForumThreadDetail extends ForumThreadSummary {
  category: ForumCategorySummary;
  canEdit: boolean;
  canDelete: boolean;
  canModerate: boolean;
  canReply: boolean;
  posts: ForumPostSummary[];
}
