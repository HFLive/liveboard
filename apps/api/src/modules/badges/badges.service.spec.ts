import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { BadgesService } from "./badges.service";

describe("BadgesService", () => {
  function createService() {
    const transaction = {
      userBadge: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          status: "active",
          systemRole: "member",
        }),
      },
      userBadge: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
      workspace: { findFirst: jest.fn() },
      badge: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    return {
      service: new BadgesService(prisma as never),
      prisma,
      transaction,
    };
  }

  it("rejects equipping more than three badges", async () => {
    const { service } = createService();

    await expect(
      service.setEquipped("user-1", ["a", "b", "c", "d"]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects badges that the member has not received", async () => {
    const { service, prisma } = createService();
    prisma.userBadge.count.mockResolvedValue(1);

    await expect(
      service.setEquipped("user-1", ["badge-1", "badge-2"]),
    ).rejects.toThrow("只能佩戴已获得的徽章");
  });

  it("replaces the equipped badge selection in order", async () => {
    const { service, transaction } = createService();

    await service.setEquipped("user-1", ["badge-2", "badge-1"]);

    expect(transaction.userBadge.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", equippedOrder: { not: null } },
      data: { equippedOrder: null },
    });
    expect(transaction.userBadge.update).toHaveBeenNthCalledWith(1, {
      where: {
        badgeId_userId: { badgeId: "badge-2", userId: "user-1" },
      },
      data: { equippedOrder: 0 },
    });
    expect(transaction.userBadge.update).toHaveBeenNthCalledWith(2, {
      where: {
        badgeId_userId: { badgeId: "badge-1", userId: "user-1" },
      },
      data: { equippedOrder: 1 },
    });
  });

  it("rejects badge creation from non-administrators", async () => {
    const { service } = createService();

    await expect(
      service.create("user-1", {
        name: "认证教师",
        description: "通过教师认证",
        color: "blue",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows administrators to create badges", async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      status: "active",
      systemRole: "admin",
    });
    prisma.workspace.findFirst.mockResolvedValue({ id: "workspace-1" });
    prisma.badge.create.mockResolvedValue({
      id: "badge-1",
      name: "认证教师",
      description: "通过教师认证",
      color: "blue",
    });

    const result = await service.create("admin-1", {
      name: "认证教师",
      description: "通过教师认证",
      color: "blue",
    });

    expect(result).toMatchObject({ id: "badge-1" });
    expect(prisma.badge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace-1",
        createdById: "admin-1",
      }),
    });
  });
});
