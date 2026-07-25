import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isSystemAdmin, type ClassroomMemberRole } from "@liveboard/shared";
import type { Prisma } from "@prisma/client";
import { Client } from "minio";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import { requireResourceName } from "../../common/resource-name";
import type {
  CreateClassroomAnnouncementDto,
  CreateClassroomDto,
  UpdateClassroomAnnouncementDto,
  UpdateClassroomDto,
} from "./classrooms.dto";

export interface UploadedClassroomFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const MAX_CLASSROOM_FILE_SIZE_BYTES = 100 * 1024 * 1024;

@Injectable()
export class ClassroomsService {
  private readonly minio: Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>("MINIO_BUCKET", "liveboard-assets");
    this.minio = new Client({
      endPoint: this.config.get<string>("MINIO_ENDPOINT", "localhost"),
      port: this.config.get<number>("MINIO_PORT", 9000),
      useSSL: this.config.get<string>("MINIO_USE_SSL", "false") === "true",
      accessKey: this.config.get<string>("MINIO_ROOT_USER", "liveboard"),
      secretKey: this.config.get<string>(
        "MINIO_ROOT_PASSWORD",
        "replace-with-a-strong-password",
      ),
    });
  }

  async list(userId: string | null) {
    const user = await this.requireUser(userId);
    const classrooms = await this.prisma.classroom.findMany({
      where: isSystemAdmin(user.systemRole)
        ? undefined
        : { members: { some: { userId: user.id } } },
      include: {
        members: { select: { userId: true, role: true } },
        _count: { select: { decks: true, exercises: true, files: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return classrooms.map((classroom) => {
      const membership = classroom.members.find(
        (member) => member.userId === user.id,
      );
      return {
        id: classroom.id,
        name: classroom.name,
        description: classroom.description,
        role: membership?.role ?? "administrator",
        teacherCount: classroom.members.filter(
          (member) => member.role === "teacher",
        ).length,
        studentCount: classroom.members.filter(
          (member) => member.role === "student",
        ).length,
        deckCount: classroom._count.decks,
        exerciseCount: classroom._count.exercises,
        fileCount: classroom._count.files,
        createdAt: classroom.createdAt.toISOString(),
        updatedAt: classroom.updatedAt.toISOString(),
      };
    });
  }

  async get(userId: string | null, classroomId: string) {
    const user = await this.requireUser(userId);
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classroomId },
      include: {
        members: {
          include: {
            user: {
              include: {
                badgeAssignments: {
                  where: { equippedOrder: { not: null } },
                  include: { badge: true },
                  orderBy: { equippedOrder: "asc" },
                  take: 3,
                },
              },
            },
          },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        },
        announcements: {
          include: {
            author: {
              include: {
                badgeAssignments: {
                  where: { equippedOrder: { not: null } },
                  include: { badge: true },
                  orderBy: { equippedOrder: "asc" },
                  take: 3,
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { decks: true, exercises: true, files: true } },
      },
    });
    if (!classroom) throw new NotFoundException("课堂不存在");

    const membership = classroom.members.find(
      (member) => member.userId === user.id,
    );
    if (!membership && !isSystemAdmin(user.systemRole)) {
      throw new ForbiddenException("你不在这个课堂中");
    }

    const canManageMembers =
      isSystemAdmin(user.systemRole) || membership?.role === "teacher";
    return {
      id: classroom.id,
      name: classroom.name,
      description: classroom.description,
      role: membership?.role ?? "administrator",
      canManageMembers,
      canEditContent: membership?.role === "teacher",
      canEditClassroom: isSystemAdmin(user.systemRole),
      teacherCount: classroom.members.filter(
        (member) => member.role === "teacher",
      ).length,
      studentCount: classroom.members.filter(
        (member) => member.role === "student",
      ).length,
      deckCount: classroom._count.decks,
      exerciseCount: classroom._count.exercises,
      fileCount: classroom._count.files,
      members: canManageMembers
        ? classroom.members.map((member) => ({
            role: member.role,
            createdAt: member.createdAt.toISOString(),
            user: this.toUserSummary(member.user),
          }))
        : undefined,
      announcements: classroom.announcements.map((announcement) =>
        this.toAnnouncementSummary(announcement),
      ),
      createdAt: classroom.createdAt.toISOString(),
      updatedAt: classroom.updatedAt.toISOString(),
    };
  }

  async createAnnouncement(
    userId: string | null,
    classroomId: string,
    input: CreateClassroomAnnouncementDto,
  ) {
    const user = await this.requireUser(userId);
    await this.requireTeacher(user, classroomId);
    const title = requireResourceName(input.title, "公告标题");
    const content = input.content.trim();
    if (!content) throw new BadRequestException("请输入公告内容");
    const announcement = await this.prisma.classroomAnnouncement.create({
      data: { classroomId, authorId: user.id, title, content },
      include: {
        author: {
          include: {
            badgeAssignments: {
              where: { equippedOrder: { not: null } },
              include: { badge: true },
              orderBy: { equippedOrder: "asc" },
              take: 3,
            },
          },
        },
      },
    });
    return this.toAnnouncementSummary(announcement);
  }

  async updateAnnouncement(
    userId: string | null,
    classroomId: string,
    announcementId: string,
    input: UpdateClassroomAnnouncementDto,
  ) {
    const user = await this.requireUser(userId);
    await this.requireTeacher(user, classroomId);
    if (input.title === undefined && input.content === undefined) {
      throw new BadRequestException("没有需要更新的内容");
    }
    const existing = await this.prisma.classroomAnnouncement.findFirst({
      where: { id: announcementId, classroomId },
    });
    if (!existing) throw new NotFoundException("课堂公告不存在");
    const content = input.content?.trim();
    if (input.content !== undefined && !content) {
      throw new BadRequestException("请输入公告内容");
    }
    const announcement = await this.prisma.classroomAnnouncement.update({
      where: { id: announcementId },
      data: {
        ...(input.title !== undefined
          ? { title: requireResourceName(input.title, "公告标题") }
          : {}),
        ...(content !== undefined ? { content } : {}),
      },
      include: {
        author: {
          include: {
            badgeAssignments: {
              where: { equippedOrder: { not: null } },
              include: { badge: true },
              orderBy: { equippedOrder: "asc" },
              take: 3,
            },
          },
        },
      },
    });
    return this.toAnnouncementSummary(announcement);
  }

  async deleteAnnouncement(
    userId: string | null,
    classroomId: string,
    announcementId: string,
  ) {
    const user = await this.requireUser(userId);
    await this.requireTeacher(user, classroomId);
    const announcement = await this.prisma.classroomAnnouncement.findFirst({
      where: { id: announcementId, classroomId },
      select: { id: true },
    });
    if (!announcement) throw new NotFoundException("课堂公告不存在");
    await this.prisma.classroomAnnouncement.delete({
      where: { id: announcement.id },
    });
    return { ok: true };
  }

  async create(userId: string | null, input: CreateClassroomDto) {
    const user = await this.requireSystemAdmin(userId);
    const name = requireResourceName(input.name, "课堂名称");
    const teacherUserIds = [...new Set(input.teacherUserIds)];
    const studentUserIds = [...new Set(input.studentUserIds ?? [])].filter(
      (id) => !teacherUserIds.includes(id),
    );
    await this.assertActiveUsers([...teacherUserIds, ...studentUserIds]);
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!workspace) throw new BadRequestException("Workspace not found");

    const classroom = await this.prisma.classroom.create({
      data: {
        workspaceId: workspace.id,
        name,
        description: input.description?.trim() || null,
        createdById: user.id,
        members: {
          create: [
            ...teacherUserIds.map((memberUserId) => ({
              userId: memberUserId,
              role: "teacher" as const,
            })),
            ...studentUserIds.map((memberUserId) => ({
              userId: memberUserId,
              role: "student" as const,
            })),
          ],
        },
      },
    });
    return this.get(user.id, classroom.id);
  }

  async update(
    userId: string | null,
    classroomId: string,
    input: UpdateClassroomDto,
  ) {
    const user = await this.requireSystemAdmin(userId);
    if (input.name === undefined && input.description === undefined) {
      throw new BadRequestException("没有需要更新的内容");
    }
    await this.requireClassroom(classroomId);
    await this.prisma.classroom.update({
      where: { id: classroomId },
      data: {
        ...(input.name !== undefined
          ? { name: requireResourceName(input.name, "课堂名称") }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description.trim() || null }
          : {}),
      },
    });
    return this.get(user.id, classroomId);
  }

  async delete(userId: string | null, classroomId: string) {
    await this.requireSystemAdmin(userId);
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classroomId },
      include: {
        files: { select: { storageKey: true } },
      },
    });
    if (!classroom) throw new NotFoundException("课堂不存在");
    await Promise.all(
      classroom.files.map((file) =>
        this.minio.removeObject(this.bucket, file.storageKey),
      ),
    );
    await this.prisma.classroom.delete({ where: { id: classroomId } });
    return { ok: true };
  }

  async upsertMember(
    userId: string | null,
    classroomId: string,
    memberUserId: string,
    role: ClassroomMemberRole,
  ) {
    const actor = await this.requireUser(userId);
    await this.requireMemberManager(actor, classroomId);
    await this.assertActiveUsers([memberUserId]);
    const existing = await this.prisma.classroomMember.findUnique({
      where: { classroomId_userId: { classroomId, userId: memberUserId } },
    });
    if (existing?.role === "teacher" && role === "student") {
      const teacherCount = await this.prisma.classroomMember.count({
        where: { classroomId, role: "teacher" },
      });
      if (teacherCount <= 1) {
        throw new ConflictException("课堂必须至少保留一名教师");
      }
    }
    await this.prisma.classroomMember.upsert({
      where: { classroomId_userId: { classroomId, userId: memberUserId } },
      create: { classroomId, userId: memberUserId, role },
      update: { role },
    });
    return this.get(actor.id, classroomId);
  }

  async removeMember(
    userId: string | null,
    classroomId: string,
    memberUserId: string,
  ) {
    const actor = await this.requireUser(userId);
    await this.requireMemberManager(actor, classroomId);
    const membership = await this.prisma.classroomMember.findUnique({
      where: { classroomId_userId: { classroomId, userId: memberUserId } },
    });
    if (!membership) throw new NotFoundException("课堂成员不存在");
    if (membership.role === "teacher") {
      const teacherCount = await this.prisma.classroomMember.count({
        where: { classroomId, role: "teacher" },
      });
      if (teacherCount <= 1) {
        throw new ConflictException("课堂必须至少保留一名教师");
      }
    }
    await this.prisma.classroomMember.delete({
      where: { classroomId_userId: { classroomId, userId: memberUserId } },
    });
    return this.get(actor.id, classroomId);
  }

  async listFiles(userId: string | null, classroomId: string) {
    const user = await this.requireUser(userId);
    await this.requireClassroomAccess(user, classroomId);
    const files = await this.prisma.classroomFile.findMany({
      where: { classroomId },
      include: { uploader: true },
      orderBy: { createdAt: "desc" },
    });
    return files.map((file) => ({
      id: file.id,
      classroomId: file.classroomId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedBy: this.toUserSummary(file.uploader),
      createdAt: file.createdAt.toISOString(),
      url: `/classrooms/${classroomId}/files/${file.id}`,
    }));
  }

  async uploadFile(
    userId: string | null,
    classroomId: string,
    file: UploadedClassroomFile | undefined,
  ) {
    const user = await this.requireUser(userId);
    await this.requireTeacher(user, classroomId);
    if (!file) throw new BadRequestException("请选择要上传的文件");
    if (file.size > MAX_CLASSROOM_FILE_SIZE_BYTES) {
      throw new BadRequestException("课堂文件不能超过 100MB");
    }
    if (looksLikeSvg(file)) {
      throw new BadRequestException("不支持上传 SVG 文件");
    }
    const classroom = await this.requireClassroom(classroomId);
    const filename = sanitizeFilename(file.originalname);
    const storageKey = `${classroom.workspaceId}/classrooms/${classroomId}/${randomUUID()}-${filename}`;
    await this.ensureBucket();

    const record = await this.reserveClassroomFile(user.id, file.size, {
      classroomId,
      storageKey,
      filename,
      mimeType: normalizeMimeType(file.mimetype),
      sizeBytes: file.size,
      uploadedBy: user.id,
    });
    try {
      await this.minio.putObject(
        this.bucket,
        storageKey,
        file.buffer,
        file.size,
        { "Content-Type": record.mimeType },
      );
    } catch (caught) {
      await this.prisma.classroomFile
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw caught;
    }
    return {
      ...record,
      createdAt: record.createdAt.toISOString(),
      url: `/classrooms/${classroomId}/files/${record.id}`,
    };
  }

  async downloadFile(
    userId: string | null,
    classroomId: string,
    fileId: string,
  ) {
    const user = await this.requireUser(userId);
    await this.requireClassroomAccess(user, classroomId);
    const file = await this.prisma.classroomFile.findFirst({
      where: { id: fileId, classroomId },
    });
    if (!file) throw new NotFoundException("课堂文件不存在");
    return {
      file,
      stream: (await this.minio.getObject(
        this.bucket,
        file.storageKey,
      )) as Readable,
    };
  }

  async deleteFile(userId: string | null, classroomId: string, fileId: string) {
    const user = await this.requireUser(userId);
    await this.requireTeacher(user, classroomId);
    const file = await this.prisma.classroomFile.findFirst({
      where: { id: fileId, classroomId },
    });
    if (!file) throw new NotFoundException("课堂文件不存在");
    await this.minio.removeObject(this.bucket, file.storageKey);
    await this.prisma.classroomFile.delete({ where: { id: file.id } });
    return { ok: true };
  }

  async requireTeacher(
    user: Awaited<ReturnType<ClassroomsService["requireUser"]>>,
    classroomId: string,
  ) {
    const membership = await this.prisma.classroomMember.findUnique({
      where: { classroomId_userId: { classroomId, userId: user.id } },
    });
    if (membership?.role !== "teacher") {
      throw new ForbiddenException("只有课堂教师可以执行此操作");
    }
    return membership;
  }

  async requireClassroomAccess(
    user: Awaited<ReturnType<ClassroomsService["requireUser"]>>,
    classroomId: string,
  ) {
    const membership = await this.prisma.classroomMember.findUnique({
      where: { classroomId_userId: { classroomId, userId: user.id } },
    });
    if (!membership && !isSystemAdmin(user.systemRole)) {
      throw new ForbiddenException("你不在这个课堂中");
    }
    return membership;
  }

  async requireUser(userId: string | null) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("User not found");
    }
    return user;
  }

  private async requireSystemAdmin(userId: string | null) {
    const user = await this.requireUser(userId);
    if (!isSystemAdmin(user.systemRole)) {
      throw new ForbiddenException("只有管理员可以管理课堂");
    }
    return user;
  }

  private async requireMemberManager(
    user: Awaited<ReturnType<ClassroomsService["requireUser"]>>,
    classroomId: string,
  ) {
    if (isSystemAdmin(user.systemRole)) {
      await this.requireClassroom(classroomId);
      return;
    }
    await this.requireTeacher(user, classroomId);
  }

  private requireClassroom(classroomId: string) {
    return this.prisma.classroom
      .findUnique({ where: { id: classroomId } })
      .then((classroom) => {
        if (!classroom) throw new NotFoundException("课堂不存在");
        return classroom;
      });
  }

  private async assertActiveUsers(userIds: string[]) {
    const uniqueIds = [...new Set(userIds)];
    const count = await this.prisma.user.count({
      where: { id: { in: uniqueIds }, status: "active" },
    });
    if (count !== uniqueIds.length) {
      throw new BadRequestException("课堂成员中包含无效用户");
    }
  }

  private async ensureBucket() {
    if (!(await this.minio.bucketExists(this.bucket).catch(() => false))) {
      await this.minio.makeBucket(this.bucket);
    }
  }

  private async reserveClassroomFile(
    userId: string,
    incomingBytes: number,
    data: Prisma.ClassroomFileUncheckedCreateInput,
  ) {
    return this.prisma.$transaction(
      async (transaction) => {
        const [user, documentUsage, classroomUsage] = await Promise.all([
          transaction.user.findUnique({
            where: { id: userId },
            select: { storageQuotaBytes: true },
          }),
          transaction.fileAsset.aggregate({
            where: { uploadedBy: userId },
            _sum: { sizeBytes: true },
          }),
          transaction.classroomFile.aggregate({
            where: { uploadedBy: userId },
            _sum: { sizeBytes: true },
          }),
        ]);
        if (!user) throw new UnauthorizedException("Missing session");
        const usage =
          (documentUsage._sum.sizeBytes ?? 0) +
          (classroomUsage._sum.sizeBytes ?? 0);
        if (usage + incomingBytes > user.storageQuotaBytes) {
          throw new BadRequestException("存储容量不足");
        }
        return transaction.classroomFile.create({ data });
      },
      { isolationLevel: "Serializable" },
    );
  }

  private toUserSummary(user: {
    id: string;
    username: string;
    displayName: string;
    avatarUpdatedAt: Date | null;
    systemRole: "super_admin" | "admin" | "member";
    status: "active" | "disabled";
    badgeAssignments?: Array<{
      badge: {
        id: string;
        name: string;
        description: string | null;
        color: string;
      };
    }>;
  }) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUpdatedAt
        ? `/auth/avatar/${user.id}?v=${user.avatarUpdatedAt.getTime()}`
        : null,
      systemRole: user.systemRole,
      status: user.status,
      badges: user.badgeAssignments?.map(({ badge }) => ({
        id: badge.id,
        name: badge.name,
        description: badge.description,
        color: normalizeBadgeColor(badge.color),
      })),
    };
  }

  private toAnnouncementSummary(announcement: {
    id: string;
    classroomId: string;
    title: string;
    content: string;
    createdAt: Date;
    updatedAt: Date;
    author: Parameters<ClassroomsService["toUserSummary"]>[0];
  }) {
    return {
      id: announcement.id,
      classroomId: announcement.classroomId,
      title: announcement.title,
      content: announcement.content,
      author: this.toUserSummary(announcement.author),
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
    };
  }
}

function normalizeBadgeColor(value: string) {
  return ["gold", "blue", "green", "purple", "red", "gray"].includes(value)
    ? (value as "gold" | "blue" | "green" | "purple" | "red" | "gray")
    : ("gray" as const);
}

function sanitizeFilename(filename: string) {
  return (filename || "classroom-file")
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_")
    .slice(0, 120);
}

function normalizeMimeType(value: string) {
  const mimeType = value.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)
    ? mimeType
    : "application/octet-stream";
}

function looksLikeSvg(file: UploadedClassroomFile) {
  const filename = file.originalname.toLowerCase();
  const declaredMime = file.mimetype.trim().toLowerCase();
  const prefix = file.buffer.subarray(0, 1024).toString("utf8").trimStart();
  return (
    filename.endsWith(".svg") ||
    declaredMime === "image/svg+xml" ||
    /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(prefix)
  );
}
