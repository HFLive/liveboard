import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import { ClassroomsService } from "./classrooms.service";

describe("ClassroomsService", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    classroom: { findUnique: jest.fn() },
    classroomMember: {
      findUnique: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    classroomAnnouncement: {
      create: jest.fn(),
    },
  };
  const config = {
    get: jest.fn((_key: string, fallback: unknown) => fallback),
  };
  let service: ClassroomsService;

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockImplementation(
      (_key: string, fallback: unknown) => fallback,
    );
    service = new ClassroomsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
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
});
