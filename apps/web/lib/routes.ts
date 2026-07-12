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
  forum: staticRoute("/app/forum"),
  forumNew: staticRoute("/app/forum/new"),
  admin: staticRoute("/app/admin"),
  adminUsers: staticRoute("/app/admin/users"),
  adminStorage: staticRoute("/app/admin/storage"),
  adminGroups: staticRoute("/app/admin/groups"),
  adminForum: staticRoute("/app/admin/forum"),
  adminAi: staticRoute("/app/admin/ai"),
  adminSettings: staticRoute("/app/admin/settings"),
  profile: staticRoute("/app/profile"),
} as const;

function routeSegment(value: string) {
  return encodeURIComponent(value);
}

export function contentDetail(fileId: string): Route {
  return `/app/content/${routeSegment(fileId)}` as Route;
}

export function contentPresentation(fileId: string): Route {
  return `/app/content/${routeSegment(fileId)}/present` as Route;
}

export function exerciseDetail(exerciseSetId: string): Route {
  return `/app/exercises/${routeSegment(exerciseSetId)}` as Route;
}

export function exerciseSubmissions(exerciseSetId: string): Route {
  return `/app/exercises/${routeSegment(exerciseSetId)}/submissions` as Route;
}

export function forumThread(threadId: string): Route {
  return `/app/forum/${routeSegment(threadId)}` as Route;
}
