import type { PrismaClient } from "@prisma/client";
import {
  bootstrapProduction,
  formatProductionBootstrapResult,
} from "./bootstrap-production";

function createPrismaMock(options?: {
  existingSuperAdmin?: boolean;
  userCount?: number;
}) {
  const transaction = {
    user: { create: jest.fn().mockResolvedValue({ id: "admin-1" }) },
    workspace: {
      upsert: jest.fn().mockResolvedValue({ id: "workspace-1" }),
    },
    forumCategory: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
  const prisma = {
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options?.existingSuperAdmin ? { id: "admin-1" } : null,
        ),
      count: jest.fn().mockResolvedValue(options?.userCount ?? 0),
    },
    $transaction: jest.fn(async (callback) => callback(transaction)),
  };

  return {
    prisma: prisma as unknown as PrismaClient,
    mocks: { prisma, transaction },
  };
}

describe("production bootstrap", () => {
  it("creates only the first administrator and essential workspace data", async () => {
    const { prisma, mocks } = createPrismaMock();

    await expect(
      bootstrapProduction(
        prisma,
        "generated-password",
        async () => "password-hash",
      ),
    ).resolves.toEqual({
      created: true,
      username: "admin",
      password: "generated-password",
    });

    expect(mocks.transaction.user.create).toHaveBeenCalledWith({
      data: {
        username: "admin",
        displayName: "管理员",
        passwordHash: "password-hash",
        systemRole: "super_admin",
        status: "active",
      },
    });
    expect(mocks.transaction.workspace.upsert).toHaveBeenCalled();
    expect(mocks.transaction.forumCategory.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it("does nothing when an active super administrator already exists", async () => {
    const { prisma, mocks } = createPrismaMock({
      existingSuperAdmin: true,
    });

    await expect(bootstrapProduction(prisma)).resolves.toEqual({
      created: false,
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to create a conflicting administrator in a populated database", async () => {
    const { prisma, mocks } = createPrismaMock({ userCount: 2 });

    await expect(bootstrapProduction(prisma)).rejects.toThrow(
      "数据库中已有用户，但没有正常状态的最高管理员",
    );
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("formats stable machine-readable credentials for the deploy script", () => {
    expect(
      formatProductionBootstrapResult(
        {
          created: true,
          username: "admin",
          password: "generated-password",
        },
        true,
      ),
    ).toEqual([
      "LIVEBOARD_BOOTSTRAP_CREATED=1",
      "LIVEBOARD_INITIAL_ADMIN_USERNAME=admin",
      "LIVEBOARD_INITIAL_ADMIN_PASSWORD=generated-password",
    ]);

    expect(formatProductionBootstrapResult({ created: false }, true)).toEqual([
      "LIVEBOARD_BOOTSTRAP_CREATED=0",
    ]);
  });
});
