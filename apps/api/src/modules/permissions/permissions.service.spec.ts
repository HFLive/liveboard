import type { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "./permissions.service";

describe("PermissionsService batch resolution", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    file: { findMany: jest.fn() },
    folder: { findMany: jest.fn() },
    permissionGroupMember: { findMany: jest.fn() },
    permissionGrant: { findMany: jest.fn() },
  };
  let service: PermissionsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new PermissionsService(prisma as unknown as PrismaService);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      status: "active",
      systemRole: "member",
    });
    prisma.permissionGroupMember.findMany.mockResolvedValue([
      { groupId: "group-1" },
    ]);
  });

  it("resolves a folder tree with two grant queries instead of per-node queries", async () => {
    prisma.folder.findMany.mockResolvedValue([
      { id: "root", parentId: null, workspaceId: "workspace-1" },
      { id: "child", parentId: "root", workspaceId: "workspace-1" },
      { id: "leaf", parentId: "child", workspaceId: "workspace-1" },
    ]);
    prisma.permissionGrant.findMany.mockResolvedValue([
      { targetType: "workspace", targetId: "workspace-1", level: "viewer" },
      { targetType: "folder", targetId: "child", level: "editor" },
    ]);

    const result = await service.getEffectiveLevelsForFolders("user-1", [
      "root",
      "child",
      "leaf",
    ]);

    expect([...result.entries()]).toEqual([
      ["root", "viewer"],
      ["child", "editor"],
      ["leaf", "editor"],
    ]);
    expect(prisma.folder.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.permissionGroupMember.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.permissionGrant.findMany).toHaveBeenCalledTimes(1);
  });

  it("combines inherited and explicit file permissions in one batch", async () => {
    prisma.file.findMany.mockResolvedValue([
      { id: "file-1", folderId: "folder-1" },
      { id: "file-2", folderId: "folder-1" },
    ]);
    prisma.folder.findMany.mockResolvedValue([
      { id: "folder-1", parentId: null, workspaceId: "workspace-1" },
    ]);
    prisma.permissionGrant.findMany
      .mockResolvedValueOnce([
        { targetType: "workspace", targetId: "workspace-1", level: "viewer" },
      ])
      .mockResolvedValueOnce([
        { targetType: "file", targetId: "file-2", level: "no_access" },
      ]);

    const result = await service.getEffectiveLevelsForFiles("user-1", [
      "file-1",
      "file-2",
    ]);

    expect([...result.entries()]).toEqual([
      ["file-1", "viewer"],
      ["file-2", "no_access"],
    ]);
    expect(prisma.file.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.permissionGrant.findMany).toHaveBeenCalledTimes(2);
  });
});
