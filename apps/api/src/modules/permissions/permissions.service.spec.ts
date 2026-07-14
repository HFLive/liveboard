import type { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "./permissions.service";

describe("PermissionsService batch resolution", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn(), findUnique: jest.fn() },
    file: { findMany: jest.fn(), findUnique: jest.fn() },
    folder: { findMany: jest.fn(), findUnique: jest.fn() },
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

  it("exposes the default workspace to system administrators", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      status: "active",
      systemRole: "admin",
    });
    prisma.workspace.findFirst.mockResolvedValue({
      id: "workspace-1",
      name: "教学空间",
    });

    await expect(
      service.getDefaultWorkspaceForPermissions("admin-1"),
    ).resolves.toEqual({ id: "workspace-1", name: "教学空间" });
  });

  it("keeps workspace permission management inside the admin center", async () => {
    await expect(
      service.getDefaultWorkspaceForPermissions("user-1"),
    ).rejects.toThrow(
      "Only system administrators can manage workspace permissions",
    );
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

  it("shows the nearest inherited group permission and its source", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      status: "active",
      systemRole: "admin",
    });
    prisma.file.findUnique.mockResolvedValue({
      workspaceId: "workspace-1",
      folderId: "child",
    });
    prisma.workspace.findUnique.mockResolvedValue({
      id: "workspace-1",
      name: "教学空间",
    });
    prisma.folder.findUnique.mockImplementation(({ where: { id } }) =>
      Promise.resolve(
        id === "child"
          ? { id: "child", parentId: "root" }
          : { id: "root", parentId: null },
      ),
    );
    prisma.folder.findMany.mockResolvedValue([
      { id: "root", name: "课程资料" },
      { id: "child", name: "第一章" },
    ]);
    prisma.permissionGrant.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "grant-root",
          targetType: "folder",
          targetId: "root",
          groupId: "group-1",
          level: "viewer",
          group: {
            id: "group-1",
            name: "学生",
            description: null,
            _count: { members: 32 },
          },
        },
        {
          id: "grant-child",
          targetType: "folder",
          targetId: "child",
          groupId: "group-1",
          level: "editor",
          group: {
            id: "group-1",
            name: "学生",
            description: null,
            _count: { members: 32 },
          },
        },
      ]);

    const result = await service.listGrants("admin-1", "file", "file-1");

    expect(result.grants).toEqual([]);
    expect(result.inheritedGrants).toEqual([
      expect.objectContaining({
        id: "grant-child",
        level: "editor",
        group: expect.objectContaining({ name: "学生", memberCount: 32 }),
        inheritedFrom: {
          targetType: "folder",
          targetId: "child",
          targetName: "第一章",
        },
      }),
    ]);
  });
});
