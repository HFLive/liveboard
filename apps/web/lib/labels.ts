import type {
  FileStatus,
  FileType,
  PermissionLevel,
  QuestionType,
  SubmissionStatus,
  SystemRole,
} from "@liveboard/shared";

const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const TIME_ZONE_STORAGE_KEY = "liveboard.timeZone";

let appTimeZone = DEFAULT_TIME_ZONE;

export function getAppTimeZone() {
  if (typeof window === "undefined") {
    return appTimeZone;
  }

  return window.localStorage.getItem(TIME_ZONE_STORAGE_KEY) || appTimeZone;
}

export function setAppTimeZone(timeZone: string) {
  appTimeZone = timeZone || DEFAULT_TIME_ZONE;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, appTimeZone);
  }
}

export function roleLabel(role: SystemRole) {
  const labels: Record<SystemRole, string> = {
    super_admin: "最高管理员",
    admin: "管理员",
    member: "普通成员",
  };

  return labels[role] ?? role;
}

export function permissionLabel(level: PermissionLevel | null | undefined) {
  const labels: Record<PermissionLevel, string> = {
    owner: "可管理",
    editor: "可编辑",
    lecturer: "可制作课件",
    viewer: "可查看",
    no_access: "禁止访问",
  };

  return level ? (labels[level] ?? level) : "-";
}

export function fileTypeLabel(type: FileType) {
  const labels: Record<FileType, string> = {
    book: "书本",
    lesson: "教案",
    course: "课程",
    exercise_set: "练习集",
    doc: "文档",
    asset: "附件",
  };

  return labels[type] ?? type;
}

export function fileStatusLabel(status: FileStatus) {
  const labels: Record<FileStatus, string> = {
    draft: "草稿",
    published: "已发布",
    archived: "已删除",
  };

  return labels[status] ?? status;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: getAppTimeZone(),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function assetTypeLabel(mimeType: string, filename: string) {
  const extension = filename.includes(".")
    ? filename.split(".").pop()?.toUpperCase()
    : null;
  const knownTypes: Record<string, string> = {
    "application/pdf": "PDF 文档",
    "application/vnd.ms-powerpoint": "PowerPoint 演示文稿",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "PowerPoint 演示文稿",
    "application/msword": "Word 文档",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "Word 文档",
    "application/vnd.ms-excel": "Excel 表格",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "Excel 表格",
    "text/csv": "CSV 表格",
    "text/plain": "文本文件",
  };

  if (knownTypes[mimeType]) {
    return extension
      ? `${knownTypes[mimeType]} / ${extension}`
      : knownTypes[mimeType];
  }

  if (mimeType.startsWith("image/")) {
    return extension ? `图片 / ${extension}` : "图片";
  }

  if (mimeType.startsWith("video/")) {
    return extension ? `视频 / ${extension}` : "视频";
  }

  if (mimeType.startsWith("audio/")) {
    return extension ? `音频 / ${extension}` : "音频";
  }

  return extension ? `附件 / ${extension}` : "附件";
}

export function questionTypeLabel(type: QuestionType) {
  const labels: Record<QuestionType, string> = {
    single_choice: "单选",
    multiple_choice: "多选",
    true_false: "判断",
    fill_blank: "填空",
    short_answer: "简答",
  };

  return labels[type] ?? type;
}

export function submissionStatusLabel(status: string | null | undefined) {
  const labels: Record<SubmissionStatus | "not_started", string> = {
    not_started: "未开始",
    in_progress: "进行中",
    submitted: "已提交",
    auto_graded: "已自动批改",
    needs_manual_review: "待人工批改",
    graded: "已批改",
    late: "已逾期",
  };

  return status ? (labels[status as SubmissionStatus] ?? status) : "未开始";
}

export function userStatusLabel(status: UserStatusString) {
  const labels: Record<UserStatusString, string> = {
    active: "正常",
    disabled: "已停用",
  };

  return labels[status] ?? status;
}

type UserStatusString = "active" | "disabled";
