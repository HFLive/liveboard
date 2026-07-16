import { ForbiddenException } from "@nestjs/common";
import { TeachingService } from "./teaching.service";

describe("TeachingService", () => {
  const activeUser = {
    id: "user-1",
    username: "learner",
    displayName: "学习者",
    systemRole: "member" as const,
    status: "active" as const,
  };

  function createService() {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(activeUser),
        findMany: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(where.id.in.map((id: string) => ({ id }))),
          ),
      },
      teachingDeck: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      teachingDeckItem: { deleteMany: jest.fn() },
      contentBlock: { findUnique: jest.fn() },
      exerciseSet: { findUnique: jest.fn() },
      workspace: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const permissions = { getEffectiveLevelForFile: jest.fn() };
    return {
      prisma,
      permissions,
      service: new TeachingService(prisma as never, permissions as never),
    };
  }

  it("allows a selected user to read a teaching deck without source permissions", async () => {
    const { service, prisma, permissions } = createService();
    prisma.teachingDeck.findUnique.mockResolvedValue({
      id: "deck-1",
      title: "公开课件",
      createdById: "teacher-1",
      createdBy: { ...activeUser, id: "teacher-1" },
      viewers: [{ userId: activeUser.id }],
      createdAt: new Date("2026-07-13T00:00:00Z"),
      updatedAt: new Date("2026-07-13T00:00:00Z"),
      items: [],
    });

    const result = await service.get(activeUser.id, "deck-1");

    expect(result.title).toBe("公开课件");
    expect(result.canEdit).toBe(false);
    expect(permissions.getEffectiveLevelForFile).not.toHaveBeenCalled();
  });

  it("refuses a user outside the teaching deck visibility range", async () => {
    const { service, prisma } = createService();
    prisma.teachingDeck.findUnique.mockResolvedValue({
      id: "deck-1",
      title: "私有课件",
      createdById: "teacher-1",
      createdBy: { ...activeUser, id: "teacher-1" },
      viewers: [],
      createdAt: new Date("2026-07-13T00:00:00Z"),
      updatedAt: new Date("2026-07-13T00:00:00Z"),
      items: [],
    });

    await expect(service.get(activeUser.id, "deck-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("refuses to copy a block the creator cannot view", async () => {
    const { service, prisma, permissions } = createService();
    prisma.contentBlock.findUnique.mockResolvedValue({
      id: "block-1",
      fileId: "file-1",
      file: { title: "受限课程" },
    });
    permissions.getEffectiveLevelForFile.mockResolvedValue(null);

    await expect(
      service.create(activeUser.id, {
        title: "课件",
        items: [{ type: "content_block", sourceBlockId: "block-1" }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
