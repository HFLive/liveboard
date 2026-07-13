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
  | "paragraph"
  | "bulleted_list"
  | "numbered_list"
  | "todo"
  | "code"
  | "quote"
  | "image"
  | "attachment"
  | "divider"
  | "reference"
  | "question";

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

export type ForumThreadStatus = "open" | "locked" | "archived";

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  systemRole: SystemRole;
  status: "active" | "disabled";
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
  children: FolderNode[];
}

export interface FileSummary {
  id: string;
  folderId: string;
  title: string;
  type: FileType;
  status: FileStatus;
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
  author: UserSummary;
  postCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ForumPostSummary {
  id: string;
  threadId: string;
  parentId: string | null;
  replyToId: string | null;
  replyTo?: {
    id: string;
    author: UserSummary;
  } | null;
  author: UserSummary;
  body: string;
  createdAt: string;
  updatedAt: string;
  canEdit?: boolean;
  canDelete?: boolean;
}

export interface ForumThreadDetail extends ForumThreadSummary {
  category: ForumCategorySummary;
  canEdit: boolean;
  canArchive: boolean;
  canModerate: boolean;
  canReply: boolean;
  posts: ForumPostSummary[];
}
