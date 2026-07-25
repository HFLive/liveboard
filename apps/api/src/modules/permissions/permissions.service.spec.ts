import type { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "./permissions.service";

describe("PermissionsService user exceptions", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    userTag: { findMany: jest.fn() },
    workspace: { findFirst: jest.fn(), findUnique: jest.fn() },
    file: { findMany: jest.fn(), findUnique: jest.fn() },
    folder: { findMany: jest.fn(), findUnique: jest.fn() },
    permissionGrant: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  };
  let service: PermissionsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new PermissionsService(prisma as unknown as PrismaService);
    prisma.user.findUnique.mockResolvedValue({
      id: "member-1",
      status: "active",
      systemRole: "member",
    });
    prisma.permissionGrant.findMany.mockResolvedValue([]);
    prisma.permissionGrant.findUnique.mockResolvedValue(null);
  });

  it("uses viewer as the default for ordinary members", async () => {
    prisma.folder.findUnique
      .mockResolvedValueOnce({
        id: "folder-1",
        workspaceId: "workspace-1",
      })
      .mockResolvedValueOnce({ id: "folder-1", parentId: null });

    await expect(
      service.getEffectiveLevelForFolder("member-1", "folder-1"),
    ).resolves.toBe("viewer");
  });

  it("keeps system administrators as document managers", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      status: "active",
      systemRole: "admin",
    });

    await expect(
      service.getEffectiveLevelForFolder("admin-1", "folder-1"),
    ).resolves.toBe("owner");
  });

  it("applies workspace and nearest folder exceptions in a batch", async () => {
    prisma.folder.findMany.mockResolvedValue([
      { id: "root", parentId: null, workspaceId: "workspace-1" },
      { id: "child", parentId: "root", workspaceId: "workspace-1" },
      { id: "leaf", parentId: "child", workspaceId: "workspace-1" },
    ]);
    prisma.permissionGrant.findMany.mockResolvedValue([
      {
        targetType: "workspace",
        targetId: "workspace-1",
        level: "no_access",
      },
      { targetType: "folder", targetId: "child", level: "editor" },
    ]);

    const result = await service.getEffectiveLevelsForFolders("member-1", [
      "root",
      "child",
      "leaf",
    ]);

    expect([...result.entries()]).toEqual([
      ["root", "no_access"],
      ["child", "no_access"],
      ["leaf", "no_access"],
    ]);
    expect(prisma.permissionGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "member-1" }),
      }),
    );
  });

  it("returns active members and tags for a manageable target", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      status: "active",
      systemRole: "admin",
    });
    prisma.user.findMany.mockResolvedValue([
      {
        id: "member-1",
        username: "student",
        displayName: "学生",
        systemRole: "member",
        status: "active",
        tagAssignments: [{ tag: { id: "tag-1", name: "一班" } }],
      },
    ]);
    prisma.userTag.findMany.mockResolvedValue([
      { id: "tag-1", name: "一班", _count: { assignments: 1 } },
    ]);

    await expect(
      service.listAssignableUsers("admin-1", "folder", "folder-1"),
    ).resolves.toEqual({
      users: [
        expect.objectContaining({
          id: "member-1",
          tags: [{ id: "tag-1", name: "一班" }],
        }),
      ],
      tags: [{ id: "tag-1", name: "一班", memberCount: 1 }],
    });
  });
});
