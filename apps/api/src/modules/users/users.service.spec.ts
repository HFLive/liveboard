import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  const actor = {
    id: "admin-1",
    username: "admin",
    displayName: "Admin",
    systemRole: "super_admin",
    status: "active",
    sessionVersion: 1,
  };
  const target = { ...actor, id: "admin-2", username: "admin-2" };
  const tx = {
    user: { count: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new UsersService(
      prisma as unknown as PrismaService,
      {} as PermissionsService,
    );
    prisma.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(target);
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    tx.user.update.mockResolvedValue({ ...target, status: "disabled" });
  });

  it("checks and updates the last super admin in one serializable transaction", async () => {
    tx.user.count.mockResolvedValue(2);

    await service.updateUser("admin-1", "admin-2", { status: "disabled" });

    expect(tx.user.count).toHaveBeenCalledWith({
      where: { systemRole: "super_admin", status: "active" },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "admin-2" },
      data: expect.objectContaining({ status: "disabled" }),
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });

  it("refuses to disable the final active super admin", async () => {
    tx.user.count.mockResolvedValue(1);

    await expect(
      service.updateUser("admin-1", "admin-2", { status: "disabled" }),
    ).rejects.toThrow("必须保留至少一位正常状态的最高管理员");
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
