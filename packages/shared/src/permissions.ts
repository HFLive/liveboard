import type { PermissionLevel, SystemRole } from "./types";

export function isSystemAdmin(role: SystemRole): boolean {
  return role === "super_admin" || role === "admin";
}

export function isSuperAdmin(role: SystemRole): boolean {
  return role === "super_admin";
}

const writeLevels = new Set<PermissionLevel>(["owner", "editor"]);

export const permissionPower: Record<
  Exclude<PermissionLevel, "no_access">,
  number
> = {
  viewer: 10,
  lecturer: 20,
  editor: 30,
  owner: 40,
};

export function isPermissionLevel(value: string): value is PermissionLevel {
  return ["owner", "editor", "lecturer", "viewer", "no_access"].includes(value);
}

export function comparePermissions(
  left: PermissionLevel | null,
  right: PermissionLevel | null,
): PermissionLevel | null {
  if (left === "no_access" || right === "no_access") {
    return "no_access";
  }

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return permissionPower[left] >= permissionPower[right] ? left : right;
}

export function computeEffectivePermission(
  inherited: PermissionLevel | null,
  explicit: PermissionLevel | null,
): PermissionLevel | null {
  if (explicit === "no_access" || inherited === "no_access") {
    return "no_access";
  }

  return explicit ?? inherited;
}

export function canView(level: PermissionLevel | null): boolean {
  return Boolean(level && level !== "no_access");
}

export function canEdit(level: PermissionLevel | null): boolean {
  return Boolean(level && writeLevels.has(level));
}

export function canManagePermissions(level: PermissionLevel | null): boolean {
  return level === "owner";
}

export function canLecture(level: PermissionLevel | null): boolean {
  return level === "owner" || level === "editor" || level === "lecturer";
}
