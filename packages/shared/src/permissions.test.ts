import { describe, expect, it } from "vitest";
import {
  canEdit,
  canManagePermissions,
  canView,
  computeEffectivePermission,
  isSuperAdmin,
  isSystemAdmin,
} from "./permissions";

describe("permissions", () => {
  it("inherits permissions when there is no explicit override", () => {
    expect(computeEffectivePermission("viewer", null)).toBe("viewer");
  });

  it("uses explicit permission over inherited permission", () => {
    expect(computeEffectivePermission("viewer", "editor")).toBe("editor");
  });

  it("always denies when no_access is present", () => {
    expect(computeEffectivePermission("owner", "no_access")).toBe("no_access");
    expect(computeEffectivePermission("no_access", "owner")).toBe("no_access");
  });

  it("maps capabilities from levels", () => {
    expect(canView("viewer")).toBe(true);
    expect(canEdit("viewer")).toBe(false);
    expect(canEdit("editor")).toBe(true);
    expect(canManagePermissions("owner")).toBe(true);
  });

  it("separates system administrators from the super administrator", () => {
    expect(isSystemAdmin("super_admin")).toBe(true);
    expect(isSystemAdmin("admin")).toBe(true);
    expect(isSystemAdmin("member")).toBe(false);
    expect(isSuperAdmin("super_admin")).toBe(true);
    expect(isSuperAdmin("admin")).toBe(false);
  });
});
