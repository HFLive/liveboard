import { ForbiddenException } from "@nestjs/common";
import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
import { FilesService } from "./files.service";

describe("FilesService", () => {
  const permissions = {
    getEffectiveLevelForFile: jest.fn(),
    getEffectiveLevelForFolder: jest.fn(),
    getEffectiveLevelsForFiles: jest.fn(),
  };
  const tx = {
    contentBlock: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    file: { update: jest.fn() },
  };
  const prisma = {
    file: { findUnique: jest.fn() },
    fileAsset: { findUnique: jest.fn() },
    contentBlock: { findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: FilesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new FilesService(
      prisma as unknown as PrismaService,
      permissions as unknown as PermissionsService,
    );
    permissions.getEffectiveLevelForFile.mockResolvedValue("editor");
    prisma.file.findUnique.mockResolvedValue({ workspaceId: "workspace-1" });
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      workspaceId: "workspace-1",
      uploadedBy: "owner-1",
      fileId: "source-file",
      folderId: null,
    });
    tx.contentBlock.findFirst.mockResolvedValue(null);
    tx.contentBlock.create.mockResolvedValue({ id: "block-1" });
    prisma.$transaction.mockImplementation((callback) => callback(tx));
  });

  it("rejects re-sharing an asset without edit permission on its source", async () => {
    permissions.getEffectiveLevelForFile
      .mockResolvedValueOnce("editor")
      .mockResolvedValueOnce("viewer");

    await expect(
      service.createBlock("editor-1", "target-file", {
        type: "image",
        dataJson: { assetId: "asset-1", url: "/api/assets/asset-1" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates the block and bumps its file version atomically", async () => {
    await service.createBlock("owner-1", "target-file", {
      type: "attachment",
      dataJson: { assetId: "asset-1" },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.contentBlock.create).toHaveBeenCalled();
    expect(tx.file.update).toHaveBeenCalledWith({
      where: { id: "target-file" },
      data: { version: { increment: 1 }, updatedById: "owner-1" },
    });
  });

  it("rejects an asset from another workspace", async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      workspaceId: "workspace-2",
      uploadedBy: "editor-1",
      fileId: null,
      folderId: null,
    });

    await expect(
      service.createBlock("editor-1", "target-file", {
        type: "image",
        dataJson: { assetId: "asset-1" },
      }),
    ).rejects.toThrow("附件不存在或不属于当前工作区");
  });
});
