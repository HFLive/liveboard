import type { Route } from "next";

function staticRoute(value: string): Route {
  return value as Route;
}

export const APP_ROUTES = {
  root: staticRoute("/app"),
  ai: staticRoute("/app/ai"),
  content: staticRoute("/app/content"),
  library: staticRoute("/app/library"),
  exercises: staticRoute("/app/exercises"),
  exercisesNew: staticRoute("/app/exercises/new"),
  teaching: staticRoute("/app/teaching"),
  teachingNew: staticRoute("/app/teaching/new"),
  forum: staticRoute("/app/forum"),
  forumNew: staticRoute("/app/forum/new"),
  admin: staticRoute("/app/admin"),
  adminUsers: staticRoute("/app/admin/users"),
  adminStorage: staticRoute("/app/admin/storage"),
  adminGroups: staticRoute("/app/admin/groups"),
  adminContentPermissions: staticRoute("/app/admin/content-permissions"),
  adminForum: staticRoute("/app/admin/forum"),
  adminAi: staticRoute("/app/admin/ai"),
  adminServerStatus: staticRoute("/app/admin/server-status"),
  adminSettings: staticRoute("/app/admin/settings"),
  profile: staticRoute("/app/profile"),
} as const;

function routeSegment(value: string) {
  return encodeURIComponent(value);
}

export function contentDetail(fileId: string): Route {
  return `/app/content/${routeSegment(fileId)}` as Route;
}

export function contentEdit(fileId: string): Route {
  return `/app/content/${routeSegment(fileId)}/edit` as Route;
}

export function exerciseDetail(exerciseSetId: string): Route {
  return `/app/exercises/${routeSegment(exerciseSetId)}` as Route;
}

export function teachingEdit(deckId: string): Route {
  return `/app/teaching/${routeSegment(deckId)}/edit` as Route;
}

export function teachingPresent(deckId: string): Route {
  return `/app/teaching/${routeSegment(deckId)}/present` as Route;
}

export function exerciseSubmissions(exerciseSetId: string): Route {
  return `/app/exercises/${routeSegment(exerciseSetId)}/submissions` as Route;
}

export function forumThread(threadId: string): Route {
  return `/app/forum/${routeSegment(threadId)}` as Route;
}

export function userProfile(userId: string): Route {
  return `/app/users/${routeSegment(userId)}` as Route;
}

/** 用于客户端导航开始时即时更新标签标题；详情数据加载后可再覆盖。 */
export function appRouteTitle(pathname: string) {
  const exactTitles = new Map<string, string>([
    [APP_ROUTES.ai, "AI"],
    [APP_ROUTES.content, "文档"],
    [APP_ROUTES.library, "文件"],
    [APP_ROUTES.exercises, "练习"],
    [APP_ROUTES.exercisesNew, "新建练习"],
    [APP_ROUTES.teaching, "课件"],
    [APP_ROUTES.teachingNew, "新建课件"],
    [APP_ROUTES.forum, "论坛"],
    [APP_ROUTES.forumNew, "发布主题"],
    [APP_ROUTES.admin, "管理中心"],
    [APP_ROUTES.adminUsers, "成员管理"],
    [APP_ROUTES.adminStorage, "容量管理"],
    [APP_ROUTES.adminGroups, "权限组"],
    [APP_ROUTES.adminContentPermissions, "文档权限"],
    [APP_ROUTES.adminForum, "论坛版块"],
    [APP_ROUTES.adminAi, "AI 服务"],
    [APP_ROUTES.adminServerStatus, "服务器状态"],
    [APP_ROUTES.adminSettings, "系统设置"],
    [APP_ROUTES.profile, "个人设置"],
  ]);
  const exactTitle = exactTitles.get(pathname);
  if (exactTitle) return exactTitle;

  if (/^\/app\/content\/[^/]+\/edit$/.test(pathname)) return "编辑文档";
  if (/^\/app\/content\/[^/]+$/.test(pathname)) return "文档";
  if (/^\/app\/teaching\/[^/]+\/edit$/.test(pathname)) return "编辑课件";
  if (/^\/app\/teaching\/[^/]+\/present$/.test(pathname)) return "课件展示";
  if (/^\/app\/exercises\/[^/]+\/submissions$/.test(pathname)) return "批改";
  if (/^\/app\/exercises\/[^/]+$/.test(pathname)) return "练习";
  if (/^\/app\/forum\/[^/]+$/.test(pathname)) return "帖子";
  if (/^\/app\/users\/[^/]+$/.test(pathname)) return "个人主页";
  return pathname === APP_ROUTES.root ? "LiveBoard" : null;
}
