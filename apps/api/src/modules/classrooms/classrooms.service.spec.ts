import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import { Readable } from "node:stream";
import { ClassroomsService } from "./classrooms.service";

describe("ClassroomsService", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    classroom: { findUnique: jest.fn(), delete: jest.fn() },
    classroomMember: {
      findUnique: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    classroomAnnouncement: {
      create: jest.fn(),
    },
    classroomFile: {
      aggregate: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    workspace: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const backend = {
    name: "minio" as const,
    putObject: jest.fn(),
    getObject: jest.fn(),
    removeObject: jest.fn(),
    presignGet: jest.fn(),
    healthCheck: jest.fn(),
  };
  const storage = {
    activeBackend: jest.fn(),
    backendFor: jest.fn(),
    presignDownload: jest.fn(),
    healthCheckActive: jest.fn(),
  };
  const notifications = { create: jest.fn() };
  let service: ClassroomsService;

  beforeEach(() => {
    jest.resetAllMocks();
    backend.removeObject.mockResolvedValue(undefined);
    storage.activeBackend.mockResolvedValue(backend);
    storage.backendFor.mockResolvedValue(backend);
    storage.presignDownload.mockResolvedValue(null);
    service = new ClassroomsService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      notifications as never,
    );
  });

  it("keeps at least one teacher in every classroom", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      status: "active",
      systemRole: "admin",
    });
    prisma.classroom.findUnique.mockResolvedValue({ id: "classroom-1" });
    prisma.classroomMember.findUnique.mockResolvedValue({
      classroomId: "classroom-1",
      userId: "teacher-1",
      role: "teacher",
    });
    prisma.classroomMember.count.mockResolvedValue(1);

    await expect(
      service.removeMember("admin-1", "classroom-1", "teacher-1"),
    ).rejects.toThrow("课堂必须至少保留一名教师");
    expect(prisma.classroomMember.delete).not.toHaveBeenCalled();
  });

  it("forbids ordinary administrators from changing classroom storage quotas", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      status: "active",
      systemRole: "admin",
    });
    prisma.classroom.findUnique.mockResolvedValue({ id: "classroom-1" });

    await expect(
      service.update("admin-1", "classroom-1", { storageQuotaBytes: 1024 }),
    ).rejects.toThrow("只有最高管理员可以调整容量上限");
  });

  it("allows a classroom teacher to publish an announcement", async () => {
    const author = {
      id: "teacher-1",
      username: "teacher",
      displayName: "Teacher",
      avatarUpdatedAt: null,
      systemRole: "member",
      status: "active",
    };
    prisma.user.findUnique.mockResolvedValue(author);
    prisma.classroomMember.findUnique.mockResolvedValue({
      classroomId: "classroom-1",
      userId: author.id,
      role: "teacher",
    });
    prisma.classroom.findUnique.mockResolvedValue({
      members: [{ userId: author.id }, { userId: "student-1" }],
    });
    prisma.classroomAnnouncement.create.mockResolvedValue({
      id: "announcement-1",
      classroomId: "classroom-1",
      title: "上课提醒",
      content: "请提前准备课件。",
      author,
      createdAt: new Date("2026-07-26T01:00:00.000Z"),
      updatedAt: new Date("2026-07-26T01:00:00.000Z"),
    });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));

    await expect(
      service.createAnnouncement("teacher-1", "classroom-1", {
        title: "上课提醒",
        content: "请提前准备课件。",
      }),
    ).resolves.toMatchObject({
      id: "announcement-1",
      author: { id: "teacher-1" },
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "classroom_announcement",
        recipientIds: ["teacher-1", "student-1"],
      }),
      prisma,
    );
  });

  it("rejects announcement creation from a classroom student", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "student-1",
      status: "active",
      systemRole: "member",
    });
    prisma.classroomMember.findUnique.mockResolvedValue({
      classroomId: "classroom-1",
      userId: "student-1",
      role: "student",
    });

    await expect(
      service.createAnnouncement("student-1", "classroom-1", {
        title: "无权发布",
        content: "不应保存",
      }),
    ).rejects.toThrow("只有课堂教师可以执行此操作");
    expect(prisma.classroomAnnouncement.create).not.toHaveBeenCalled();
  });

  it("hard deletes a classroom and removes its stored files", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      status: "active",
      systemRole: "admin",
    });
    prisma.classroom.findUnique.mockResolvedValue({
      id: "classroom-1",
      files: [
        {
          storageKey: "ws/classrooms/classroom-1/a.pdf",
          storageBackend: "minio",
        },
        {
          storageKey: "ws/classrooms/classroom-1/b.pptx",
          storageBackend: "minio",
        },
      ],
    });
    prisma.classroom.delete.mockResolvedValue({ id: "classroom-1" });

    await expect(service.delete("admin-1", "classroom-1")).resolves.toEqual({
      ok: true,
    });
    expect(storage.backendFor).toHaveBeenCalledWith("minio");
    expect(backend.removeObject).toHaveBeenCalledTimes(2);
    expect(backend.removeObject).toHaveBeenCalledWith(
      "ws/classrooms/classroom-1/a.pdf",
    );
    expect(backend.removeObject).toHaveBeenCalledWith(
      "ws/classrooms/classroom-1/b.pptx",
    );
    expect(prisma.classroom.delete).toHaveBeenCalledWith({
      where: { id: "classroom-1" },
    });
  });

  it("rejects classroom deletion from a non-admin member", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "member-1",
      status: "active",
      systemRole: "member",
    });

    await expect(service.delete("member-1", "classroom-1")).rejects.toThrow(
      "只有管理员可以管理课堂",
    );
    expect(backend.removeObject).not.toHaveBeenCalled();
    expect(prisma.classroom.delete).not.toHaveBeenCalled();
  });

  function mockTeacherUpload() {
    prisma.user.findUnique.mockResolvedValue({
      id: "teacher-1",
      status: "active",
      systemRole: "member",
    });
    prisma.classroomMember.findUnique.mockResolvedValue({
      classroomId: "classroom-1",
      userId: "teacher-1",
      role: "teacher",
    });
    prisma.classroomFile.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
  }

  it("rejects classroom file uploads beyond the classroom quota", async () => {
    mockTeacherUpload();
    prisma.classroom.findUnique.mockResolvedValue({
      id: "classroom-1",
      workspaceId: "ws-1",
      storageQuotaBytes: 150,
    });
    prisma.classroomFile.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 100 },
    });

    await expect(
      service.uploadFile("teacher-1", "classroom-1", {
        originalname: "讲义.txt",
        mimetype: "text/plain",
        size: 100,
        buffer: Buffer.alloc(100),
      }),
    ).rejects.toThrow("课堂文件容量不足");
    expect(prisma.classroomFile.create).not.toHaveBeenCalled();
    expect(backend.putObject).not.toHaveBeenCalled();
  });

  it("uploads classroom files within the classroom quota", async () => {
    mockTeacherUpload();
    prisma.classroom.findUnique.mockResolvedValue({
      id: "classroom-1",
      workspaceId: "ws-1",
      storageQuotaBytes: 1024,
    });
    prisma.classroomFile.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 0 },
    });
    prisma.classroomFile.create.mockResolvedValue({
      id: "cf-1",
      classroomId: "classroom-1",
      storageKey: "ws-1/classrooms/classroom-1/key-讲义.txt",
      filename: "讲义.txt",
      mimeType: "text/plain",
      sizeBytes: 100,
      storageBackend: "minio",
      createdAt: new Date("2026-07-27T00:00:00Z"),
    });

    await expect(
      service.uploadFile("teacher-1", "classroom-1", {
        originalname: "讲义.txt",
        mimetype: "text/plain",
        size: 100,
        buffer: Buffer.alloc(100),
      }),
    ).resolves.toMatchObject({ id: "cf-1" });
    expect(prisma.classroomFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        classroomId: "classroom-1",
        storageBackend: "minio",
      }),
    });
    expect(backend.putObject).toHaveBeenCalledWith(
      expect.stringContaining("ws-1/classrooms/classroom-1/"),
      expect.any(Buffer),
      "text/plain",
    );
  });

  it("rejects invalid classroom filenames instead of silently replacing them", async () => {
    mockTeacherUpload();

    await expect(
      service.uploadFile("teacher-1", "classroom-1", {
        originalname: "讲义\u200b.txt",
        mimetype: "text/plain",
        size: 100,
        buffer: Buffer.alloc(100),
      }),
    ).rejects.toThrow("文件名称不能包含换行、控制字符或不可见字符");
    expect(prisma.classroomFile.create).not.toHaveBeenCalled();
    expect(backend.putObject).not.toHaveBeenCalled();
  });

  it("rejects duplicate filenames in the same classroom", async () => {
    mockTeacherUpload();
    prisma.classroom.findUnique.mockResolvedValue({
      id: "classroom-1",
      workspaceId: "ws-1",
      storageQuotaBytes: 1024,
    });
    prisma.classroomFile.findFirst.mockResolvedValue({ id: "cf-existing" });
    prisma.classroomFile.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 0 },
    });

    await expect(
      service.uploadFile("teacher-1", "classroom-1", {
        originalname: "讲义.txt",
        mimetype: "text/plain",
        size: 100,
        buffer: Buffer.alloc(100),
      }),
    ).rejects.toThrow("当前课堂中已存在同名文件");
    expect(prisma.classroomFile.create).not.toHaveBeenCalled();
    expect(backend.putObject).not.toHaveBeenCalled();
  });

  it("previews a UTF-8 classroom text file for a classroom member", async () => {
    const content = Buffer.from("第一行\n第二行");
    prisma.user.findUnique.mockResolvedValue({
      id: "student-1",
      status: "active",
      systemRole: "member",
    });
    prisma.classroomMember.findUnique.mockResolvedValue({
      classroomId: "classroom-1",
      userId: "student-1",
      role: "student",
    });
    prisma.classroomFile.findFirst.mockResolvedValue({
      id: "file-1",
      classroomId: "classroom-1",
      filename: "讲义.txt",
      mimeType: "text/plain",
      sizeBytes: content.length,
      storageBackend: "minio",
      storageKey: "classrooms/file-1",
    });
    backend.getObject.mockResolvedValue(Readable.from(content));

    await expect(
      service.previewFile("student-1", "classroom-1", "file-1"),
    ).resolves.toMatchObject({
      kind: "text",
      content: "第一行\n第二行",
    });
  });

  it("lets the storage policy choose direct or proxied delivery for inline images", async () => {
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    prisma.user.findUnique.mockResolvedValue({
      id: "student-1",
      status: "active",
      systemRole: "member",
    });
    prisma.classroomMember.findUnique.mockResolvedValue({
      classroomId: "classroom-1",
      userId: "student-1",
      role: "student",
    });
    prisma.classroomFile.findFirst.mockResolvedValue({
      id: "file-1",
      classroomId: "classroom-1",
      filename: "课堂截图.png",
      mimeType: "image/png",
      sizeBytes: content.length,
      storageBackend: "oss",
      storageKey: "classrooms/file-1",
    });
    backend.getObject.mockResolvedValue(Readable.from(content));

    await expect(
      service.downloadFile("student-1", "classroom-1", "file-1", true),
    ).resolves.toMatchObject({
      inline: true,
      redirectUrl: null,
    });
    expect(storage.presignDownload).toHaveBeenCalledWith(
      "oss",
      "classrooms/file-1",
      {
        filename: "课堂截图.png",
        mimeType: "image/png",
        inline: true,
      },
    );
    expect(backend.getObject).toHaveBeenCalledWith("classrooms/file-1");
  });

  it("does not read a classroom preview for a non-member", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "outsider-1",
      status: "active",
      systemRole: "member",
    });
    prisma.classroomMember.findUnique.mockResolvedValue(null);

    await expect(
      service.previewFile("outsider-1", "classroom-1", "file-1"),
    ).rejects.toThrow("你不在这个课堂中");
    expect(backend.getObject).not.toHaveBeenCalled();
  });
});

describe("ClassroomsService direct upload", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    classroom: { findUnique: jest.fn() },
    classroomMember: { findUnique: jest.fn() },
    classroomFile: {
      aggregate: jest.fn(),
      findFirst: jest.fn(),
    },
    pendingUpload: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    workspace: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const backend = {
    name: "oss" as const,
    statObject: jest.fn(),
    removeObject: jest.fn(),
  };
  const storage = {
    activeBackend: jest.fn(),
    backendFor: jest.fn(),
    signUpload: jest.fn(),
    objectKeyForPendingUpload: jest.fn((_backend: string, key: string) => key),
    discardMultipartUpload: jest.fn(),
    verifyAndFinalizePendingObject: jest.fn(),
    discardPendingUpload: jest.fn(),
  };
  let service: ClassroomsService;

  const teacher = {
    id: "teacher-1",
    username: "teacher",
    displayName: "Teacher",
    avatarUpdatedAt: null,
    systemRole: "member" as const,
    status: "active" as const,
  };
  const pendingRow = {
    id: "upload-1",
    kind: "classroom" as const,
    workspaceId: "workspace-1",
    folderId: null,
    fileId: null,
    classroomId: "classroom-1",
    forumPostId: null,
    storageBackend: "oss" as const,
    filename: "slides.pdf",
    mimeType: "application/pdf",
    sizeBytes: 5,
    storageKey: "workspace-1/classrooms/classroom-1/abc-slides.pdf",
    uploadedBy: "teacher-1",
    createdAt: new Date("2026-07-29T00:00:00Z"),
    expiresAt: new Date(Date.now() + 60_000),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ClassroomsService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      { create: jest.fn() } as never,
    );
    prisma.user.findUnique.mockResolvedValue(teacher);
    prisma.classroomMember.findUnique.mockResolvedValue({
      classroomId: "classroom-1",
      userId: teacher.id,
      role: "teacher",
    });
    prisma.classroom.findUnique.mockResolvedValue({
      id: "classroom-1",
      workspaceId: "workspace-1",
      storageQuotaBytes: null,
    });
    prisma.workspace.findUnique.mockResolvedValue(null);
    prisma.classroomFile.findFirst.mockResolvedValue(null);
    prisma.classroomFile.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 0 },
    });
    prisma.pendingUpload.findMany.mockResolvedValue([]);
    prisma.pendingUpload.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 0 },
    });
    prisma.pendingUpload.create.mockResolvedValue(pendingRow);
    prisma.pendingUpload.findUnique.mockResolvedValue(pendingRow);
    prisma.pendingUpload.delete.mockResolvedValue(pendingRow);
    storage.activeBackend.mockResolvedValue(backend);
    storage.backendFor.mockResolvedValue(backend);
    storage.objectKeyForPendingUpload.mockImplementation(
      (_backend: string, key: string) => key,
    );
    storage.signUpload.mockResolvedValue({
      transport: "form_post",
      url: "https://oss.example/upload",
      fields: { policy: "signed-policy" },
      expiresAt: "2026-07-29T00:10:00.000Z",
    });
    storage.verifyAndFinalizePendingObject.mockResolvedValue(undefined);
    storage.discardPendingUpload.mockResolvedValue(undefined);
    backend.statObject.mockResolvedValue({ size: 5 });
    backend.removeObject.mockResolvedValue(undefined);
  });

  it("signs a direct classroom upload and reserves a pending row", async () => {
    const result = await service.signFileUpload("teacher-1", "classroom-1", {
      filename: "slides.pdf",
      sizeBytes: 5,
      mimeType: "application/pdf",
    });

    expect(result).toEqual({
      uploadId: "upload-1",
      instruction: {
        transport: "form_post",
        url: "https://oss.example/upload",
        fields: { policy: "signed-policy" },
        expiresAt: "2026-07-29T00:10:00.000Z",
      },
      expiresAt: "2026-07-29T00:10:00.000Z",
    });
    expect(storage.signUpload).toHaveBeenCalledWith(
      "oss",
      expect.stringMatching(
        /^workspace-1\/classrooms\/classroom-1\/.+-slides\.pdf$/,
      ),
      { sizeBytes: 5, mimeType: "application/pdf" },
    );
    expect(prisma.pendingUpload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "classroom",
        classroomId: "classroom-1",
        filename: "slides.pdf",
        sizeBytes: 5,
        uploadedBy: "teacher-1",
        storageKey: expect.stringMatching(
          /^workspace-1\/classrooms\/classroom-1\/.+-slides\.pdf$/,
        ),
      }),
    });
  });

  it("rejects signing from a classroom student", async () => {
    prisma.classroomMember.findUnique.mockResolvedValue({
      classroomId: "classroom-1",
      userId: teacher.id,
      role: "student",
    });

    await expect(
      service.signFileUpload("teacher-1", "classroom-1", {
        filename: "slides.pdf",
        sizeBytes: 5,
      }),
    ).rejects.toThrow("只有课堂教师可以执行此操作");
    expect(prisma.pendingUpload.create).not.toHaveBeenCalled();
  });

  it("rejects SVG files without reading object content", async () => {
    await expect(
      service.signFileUpload("teacher-1", "classroom-1", {
        filename: "evil.svg",
        sizeBytes: 5,
        mimeType: "image/svg+xml",
      }),
    ).rejects.toThrow("不支持上传 SVG 文件");
    expect(prisma.pendingUpload.create).not.toHaveBeenCalled();
  });

  it("rejects signing when the storage configuration has no direct upload", async () => {
    storage.signUpload.mockResolvedValue(null);

    await expect(
      service.signFileUpload("teacher-1", "classroom-1", {
        filename: "slides.pdf",
        sizeBytes: 5,
      }),
    ).rejects.toThrow("当前存储配置不支持签名直入");
    expect(prisma.pendingUpload.create).not.toHaveBeenCalled();
  });

  it("counts unexpired pending uploads toward the quota pre-check", async () => {
    prisma.workspace.findUnique.mockResolvedValue({
      classroomStorageQuotaBytes: 6,
    });
    prisma.pendingUpload.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 4 },
    });

    await expect(
      service.signFileUpload("teacher-1", "classroom-1", {
        filename: "slides.pdf",
        sizeBytes: 5,
      }),
    ).rejects.toThrow("课堂文件容量不足");
    expect(prisma.pendingUpload.create).not.toHaveBeenCalled();
  });

  it("confirm creates the record and releases the reservation", async () => {
    const created = {
      id: "file-1",
      classroomId: "classroom-1",
      filename: "slides.pdf",
      createdAt: new Date("2026-07-29T01:00:00Z"),
    };
    const tx = {
      workspace: { findUnique: jest.fn().mockResolvedValue(null) },
      classroomFile: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
      pendingUpload: { delete: jest.fn().mockResolvedValue(pendingRow) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.confirmFileUpload(
      "teacher-1",
      "classroom-1",
      "upload-1",
    );

    expect(tx.classroomFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        classroomId: "classroom-1",
        storageKey: pendingRow.storageKey,
        storageBackend: "oss",
        filename: "slides.pdf",
        sizeBytes: 5,
      }),
    });
    expect(tx.pendingUpload.delete).toHaveBeenCalledWith({
      where: { id: "upload-1" },
    });
    expect(result.url).toBe("/classrooms/classroom-1/files/file-1");
    expect(backend.removeObject).not.toHaveBeenCalled();
  });

  it("confirm discards the object when the size does not match", async () => {
    storage.verifyAndFinalizePendingObject.mockRejectedValue(
      new BadRequestException("上传内容不完整"),
    );

    await expect(
      service.confirmFileUpload("teacher-1", "classroom-1", "upload-1"),
    ).rejects.toThrow("上传内容不完整");
    expect(storage.discardPendingUpload).toHaveBeenCalledWith(pendingRow);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("confirm discards the object when the filename duplicates", async () => {
    const tx = {
      workspace: { findUnique: jest.fn().mockResolvedValue(null) },
      classroomFile: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
        findFirst: jest.fn().mockResolvedValue({ id: "existing-file" }),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    await expect(
      service.confirmFileUpload("teacher-1", "classroom-1", "upload-1"),
    ).rejects.toThrow("当前课堂中已存在同名文件");
    expect(tx.classroomFile.create).not.toHaveBeenCalled();
    expect(storage.discardPendingUpload).toHaveBeenCalledWith(pendingRow);
  });

  it("abort is idempotent and cleans up the object", async () => {
    await expect(
      service.abortFileUpload("teacher-1", "classroom-1", "upload-1"),
    ).resolves.toEqual({ ok: true });
    expect(storage.discardPendingUpload).toHaveBeenCalledWith(pendingRow);

    prisma.pendingUpload.findUnique.mockResolvedValue(null);
    storage.discardPendingUpload.mockClear();
    await expect(
      service.abortFileUpload("teacher-1", "classroom-1", "upload-1"),
    ).resolves.toEqual({ ok: true });
    expect(storage.discardPendingUpload).not.toHaveBeenCalled();
  });
});
