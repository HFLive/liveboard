import type { PrismaService } from "../prisma/prisma.service";
import type { HfliveAuthConfig } from "../hflive-auth/hflive-auth.config";
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
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    externalIdentity: { findUnique: jest.fn() },
    authenticationAuditEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const hfliveConfig = { enabled: false };
  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new UsersService(
      prisma as unknown as PrismaService,
      hfliveConfig as unknown as HfliveAuthConfig,
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

  it("forbids ordinary administrators from changing storage quotas", async () => {
    prisma.user.findUnique
      .mockReset()
      .mockResolvedValueOnce({ ...actor, systemRole: "admin" })
      .mockResolvedValueOnce({ ...target, systemRole: "member" });

    await expect(
      service.updateUser("admin-1", "member-1", { storageQuotaBytes: 1024 }),
    ).rejects.toThrow("只有最高管理员可以调整容量上限");
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("forbids ordinary administrators from reading storage quotas", async () => {
    prisma.user.findUnique.mockReset().mockResolvedValue({
      ...actor,
      systemRole: "admin",
    });

    await expect(service.listUserStorage("admin-1")).rejects.toThrow(
      "只有最高管理员可以管理容量设置",
    );
  });

  it("rejects displayName and password changes for HFLive-linked users", async () => {
    prisma.externalIdentity.findUnique.mockResolvedValue({ id: "identity-1" });
    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: true,
    });
    const mockAdminAndMember = () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique
        .mockResolvedValueOnce({ ...actor, systemRole: "admin" })
        .mockResolvedValueOnce({
          ...target,
          systemRole: "member",
          status: "active",
        });
    };

    mockAdminAndMember();
    await expect(
      service.updateUser("admin-1", "admin-2", { displayName: "新名字" }),
    ).rejects.toThrow("统一身份资料请前往 HFLive Auth 修改");
    expect(tx.user.update).not.toHaveBeenCalled();

    mockAdminAndMember();
    await expect(
      service.updateUser("admin-1", "admin-2", {
        password: "long-enough-pass",
      }),
    ).rejects.toThrow("统一身份密码由 HFLive Auth 管理");
    expect(tx.user.update).not.toHaveBeenCalled();

    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: false,
    });
  });

  it("allows local-mode updates for users without an HFLive identity", async () => {
    prisma.externalIdentity.findUnique.mockResolvedValue(null);
    tx.user.update.mockResolvedValue({ ...target, displayName: "本地名字" });

    await service.updateUser("admin-1", "admin-2", { displayName: "本地名字" });

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ displayName: "本地名字" }),
      }),
    );
  });

  it("only lets a super admin rename the username with case-insensitive dedup", async () => {
    prisma.user.findUnique.mockReset();
    prisma.user.findUnique
      .mockResolvedValueOnce({ ...actor, systemRole: "admin" })
      .mockResolvedValueOnce({ ...target, systemRole: "member" });
    await expect(
      service.updateUser("admin-1", "admin-2", { username: "new_name" }),
    ).rejects.toThrow("只有最高管理员可以修改登录账号");
    expect(tx.user.update).not.toHaveBeenCalled();

    prisma.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce({ ...target, systemRole: "member" });
    prisma.user.findFirst.mockResolvedValue({ id: "member-9" });
    await expect(
      service.updateUser("admin-1", "admin-2", { username: "new_name" }),
    ).rejects.toThrow("该登录账号已被其他用户占用");
    expect(tx.user.update).not.toHaveBeenCalled();

    prisma.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce({ ...target, systemRole: "member" });
    prisma.user.findFirst.mockResolvedValue(null);
    tx.user.update.mockResolvedValue({
      ...target,
      username: "new_name",
      sessionVersion: 2,
    });
    await service.updateUser("admin-1", "admin-2", { username: "new_name" });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: "new_name",
          sessionVersion: { increment: 1 },
        }),
      }),
    );
    expect(prisma.authenticationAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "admin.user.username.renamed",
        }),
      }),
    );
  });

  it("bulk updates statuses with per-target permission rules and skips violators", async () => {
    prisma.user.findUnique.mockReset().mockResolvedValue({
      ...actor,
      systemRole: "admin",
    });
    prisma.user.findMany.mockResolvedValue([
      { id: "m1", systemRole: "member", status: "active" },
      { id: "m2", systemRole: "member", status: "active" },
      { id: "admin-2", systemRole: "admin", status: "active" },
      { id: "admin-1", systemRole: "super_admin", status: "active" },
      { id: "m3", systemRole: "member", status: "disabled" },
    ]);
    tx.user.update.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve({ ...target, id: args.where.id, status: "disabled" }),
    );

    const result = await service.bulkUpdateUserStatus(
      "admin-1",
      ["m1", "m2", "admin-2", "admin-1", "m3", "missing-id"],
      "disabled",
    );
    // m1/m2 更新；admin-2（管理员越权）、admin-1（自身）、m3（已是停用）、
    // missing-id（不存在）计入 skipped。
    expect(result).toEqual({ updated: 2, skipped: 4 });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "m1" },
        data: { status: "disabled", sessionVersion: { increment: 1 } },
      }),
    );
  });

  it("skips disabling the last active super admin in bulk", async () => {
    prisma.user.findUnique.mockReset().mockResolvedValue(actor);
    prisma.user.findMany.mockResolvedValue([
      { id: "s1", systemRole: "super_admin", status: "active" },
      { id: "m1", systemRole: "member", status: "active" },
    ]);
    prisma.user.count.mockResolvedValue(1);
    tx.user.update.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve({ ...target, id: args.where.id, status: "disabled" }),
    );

    const result = await service.bulkUpdateUserStatus(
      "admin-1",
      ["s1", "m1"],
      "disabled",
    );
    expect(result).toEqual({ updated: 1, skipped: 1 });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1" } }),
    );
    expect(tx.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1" } }),
    );
  });
});
