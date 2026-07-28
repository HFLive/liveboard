import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
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
    prisma.classroomAnnouncement.create.mockResolvedValue({
      id: "announcement-1",
      classroomId: "classroom-1",
      title: "上课提醒",
      content: "请提前准备课件。",
      author,
      createdAt: new Date("2026-07-26T01:00:00.000Z"),
      updatedAt: new Date("2026-07-26T01:00:00.000Z"),
    });

    await expect(
      service.createAnnouncement("teacher-1", "classroom-1", {
        title: "上课提醒",
        content: "请提前准备课件。",
      }),
    ).resolves.toMatchObject({
      id: "announcement-1",
      author: { id: "teacher-1" },
    });
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
});
