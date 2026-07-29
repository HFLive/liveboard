import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from "@nestjs/common";
import { isSystemAdmin, type ClassroomMemberRole } from "@liveboard/shared";
import type { PendingUpload, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { StorageService } from "../storage/storage.service";
import { requireResourceName } from "../../common/resource-name";
import { putObjectWithCompensation } from "../storage/upload-compensation";
import { DEFAULT_CLASSROOM_STORAGE_QUOTA_BYTES } from "../../common/storage-quota";
import {
  getAssetPreviewKind,
  isSafeInlineAssetMime,
  MAX_PDF_PREVIEW_SIZE_BYTES,
  MAX_TEXT_PREVIEW_SIZE_BYTES,
  readPreviewBuffer,
} from "../files/assets.service";
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
/** 签名直入预留的有效期;超时未确认的预留会被定时及惰性清理。 */
const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000;

export interface SignClassroomUploadInput {
  filename: string;
  sizeBytes: number;
  mimeType?: string;
}

@Injectable()
export class ClassroomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

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
    const usageRows = await this.prisma.classroomFile.groupBy({
      by: ["classroomId"],
      where: { classroomId: { in: classrooms.map((item) => item.id) } },
      _sum: { sizeBytes: true },
    });
    const usageByClassroom = new Map(
      usageRows.map((row) => [row.classroomId, row._sum.sizeBytes ?? 0]),
    );
    const defaultQuotaBytes = classrooms[0]
      ? await this.getWorkspaceClassroomQuota(classrooms[0].workspaceId)
      : DEFAULT_CLASSROOM_STORAGE_QUOTA_BYTES;

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
        storageQuotaBytes: classroom.storageQuotaBytes ?? defaultQuotaBytes,
        storageQuotaCustom: classroom.storageQuotaBytes !== null,
        storageUsedBytes: usageByClassroom.get(classroom.id) ?? 0,
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

    const usage = await this.prisma.classroomFile.aggregate({
      where: { classroomId },
      _sum: { sizeBytes: true },
    });
    const defaultQuotaBytes = await this.getWorkspaceClassroomQuota(
      classroom.workspaceId,
    );

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
      storageQuotaBytes: classroom.storageQuotaBytes ?? defaultQuotaBytes,
      storageQuotaCustom: classroom.storageQuotaBytes !== null,
      storageUsedBytes: usage._sum.sizeBytes ?? 0,
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
    const announcement = await this.prisma.$transaction(async (transaction) => {
      const classroom = await transaction.classroom.findUnique({
        where: { id: classroomId },
        select: {
          members: { select: { userId: true } },
        },
      });
      if (!classroom) throw new NotFoundException("课堂不存在");
      const created = await transaction.classroomAnnouncement.create({
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
      await this.notifications.create(
        {
          type: "classroom_announcement",
          category: "classroom",
          priority: "important",
          actorId: user.id,
          classroomId,
          targetType: "classroom_announcement",
          targetId: created.id,
          title: `课堂公告：${title}`,
          detail: `${user.displayName}发布了新公告`,
          href: `/app/classrooms/${encodeURIComponent(classroomId)}`,
          recipientIds: classroom.members.map(({ userId: id }) => id),
        },
        transaction,
      );
      return created;
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
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.storageQuotaBytes === undefined
    ) {
      throw new BadRequestException("没有需要更新的内容");
    }
    await this.requireClassroom(classroomId);
    if (input.storageQuotaBytes !== undefined) {
      if (
        input.storageQuotaBytes !== null &&
        (!Number.isInteger(input.storageQuotaBytes) ||
          input.storageQuotaBytes < 0)
      ) {
        throw new BadRequestException("容量上限必须是非负整数");
      }
      const [workspace, usage] = await Promise.all([
        this.prisma.workspace.findFirst({
          select: { classroomStorageQuotaBytes: true },
        }),
        this.prisma.classroomFile.aggregate({
          where: { classroomId },
          _sum: { sizeBytes: true },
        }),
      ]);
      const effectiveQuota =
        input.storageQuotaBytes ??
        workspace?.classroomStorageQuotaBytes ??
        DEFAULT_CLASSROOM_STORAGE_QUOTA_BYTES;
      if (effectiveQuota < (usage._sum.sizeBytes ?? 0)) {
        throw new BadRequestException(
          `容量上限不能低于课堂当前已用空间 ${formatStorageSize(usage._sum.sizeBytes ?? 0)}`,
        );
      }
    }
    await this.prisma.classroom.update({
      where: { id: classroomId },
      data: {
        ...(input.name !== undefined
          ? { name: requireResourceName(input.name, "课堂名称") }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description.trim() || null }
          : {}),
        ...(input.storageQuotaBytes !== undefined
          ? { storageQuotaBytes: input.storageQuotaBytes }
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
        files: { select: { storageKey: true, storageBackend: true } },
      },
    });
    if (!classroom) throw new NotFoundException("课堂不存在");
    await Promise.all(
      classroom.files.map(async (file) => {
        const backend = await this.storage.backendFor(file.storageBackend);
        await backend.removeObject(file.storageKey);
      }),
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
    await this.prisma.$transaction(async (transaction) => {
      const classroom = await transaction.classroom.findUnique({
        where: { id: classroomId },
        select: { name: true },
      });
      if (!classroom) throw new NotFoundException("课堂不存在");
      await transaction.classroomMember.upsert({
        where: { classroomId_userId: { classroomId, userId: memberUserId } },
        create: { classroomId, userId: memberUserId, role },
        update: { role },
      });
      await this.notifications.create(
        {
          type: existing ? "classroom_role_changed" : "classroom_joined",
          category: "permission",
          priority: "important",
          actorId: actor.id,
          classroomId,
          targetType: "classroom",
          targetId: classroomId,
          title: existing ? "课堂身份已更新" : "已加入课堂",
          detail: existing
            ? `你在“${classroom.name}”中的身份已调整为${role === "teacher" ? "教师" : "学生"}`
            : `你已作为${role === "teacher" ? "教师" : "学生"}加入“${classroom.name}”`,
          href: `/app/classrooms/${encodeURIComponent(classroomId)}`,
          recipientIds: [memberUserId],
        },
        transaction,
      );
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
    await this.prisma.$transaction(async (transaction) => {
      const classroom = await transaction.classroom.findUnique({
        where: { id: classroomId },
        select: { name: true },
      });
      if (!classroom) throw new NotFoundException("课堂不存在");
      await transaction.classroomMember.delete({
        where: { classroomId_userId: { classroomId, userId: memberUserId } },
      });
      await this.notifications.create(
        {
          type: "classroom_removed",
          category: "permission",
          priority: "important",
          actorId: actor.id,
          classroomId,
          targetType: "classroom",
          targetId: classroomId,
          title: "课堂成员关系已变更",
          detail: `你已被移出“${classroom.name}”`,
          href: "/app/classrooms",
          recipientIds: [memberUserId],
        },
        transaction,
      );
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
    signal?: AbortSignal,
  ) {
    const user = await this.requireUser(userId);
    await this.requireTeacher(user, classroomId);
    if (!file) throw new BadRequestException("请选择要上传的文件");
    if (file.size > MAX_CLASSROOM_FILE_SIZE_BYTES) {
      throw new BadRequestException("课堂文件不能超过 100MB");
    }
    const filename = requireResourceName(file.originalname, "文件名称");
    if (looksLikeSvg(file)) {
      throw new BadRequestException("不支持上传 SVG 文件");
    }
    const classroom = await this.requireClassroom(classroomId);
    const storageFilename = sanitizeStorageFilename(filename);
    const storageKey = `${classroom.workspaceId}/classrooms/${classroomId}/${randomUUID()}-${storageFilename}`;
    const backend = await this.storage.activeBackend();

    const record = await this.reserveClassroomFile(classroom, file.size, {
      classroomId,
      storageKey,
      storageBackend: backend.name,
      filename,
      mimeType: normalizeMimeType(file.mimetype),
      sizeBytes: file.size,
      uploadedBy: user.id,
    });
    await putObjectWithCompensation({
      backend,
      storageKey,
      data: file.buffer,
      mimeType: record.mimeType,
      signal,
      releaseReservation: () =>
        this.prisma.classroomFile.delete({ where: { id: record.id } }),
    });
    return {
      ...record,
      createdAt: record.createdAt.toISOString(),
      url: `/classrooms/${classroomId}/files/${record.id}`,
    };
  }

  /**
   * 签名直入第一步:校验并预留 PendingUpload,返回浏览器直传 OSS 的
   * 带大小约束的 POST Policy。配额与重名的原子保证在 confirm 时由
   * reserveClassroomFile 完成,这里只做 UX 预检。
   */
  async signFileUpload(
    userId: string | null,
    classroomId: string,
    input: SignClassroomUploadInput,
  ) {
    const user = await this.requireUser(userId);
    await this.requireTeacher(user, classroomId);

    const filename = requireResourceName(input.filename, "文件名称");
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new BadRequestException("无效的文件大小");
    }
    if (input.sizeBytes > MAX_CLASSROOM_FILE_SIZE_BYTES) {
      throw new BadRequestException("课堂文件不能超过 100MB");
    }
    if (looksLikeSvgDirect(filename, input.mimeType)) {
      throw new BadRequestException("不支持上传 SVG 文件");
    }
    const mimeType = normalizeMimeType(input.mimeType ?? "");

    const classroom = await this.requireClassroom(classroomId);
    const backend = await this.storage.activeBackend();
    const storageFilename = sanitizeStorageFilename(filename);
    const storageKey = `${classroom.workspaceId}/classrooms/${classroomId}/${randomUUID()}-${storageFilename}`;
    const upload = await this.storage.presignUpload(backend.name, storageKey, {
      sizeBytes: input.sizeBytes,
      mimeType,
    });
    if (!upload) {
      throw new NotImplementedException(
        "当前存储配置不支持签名直入,请改用服务器中转上传",
      );
    }

    await this.reapExpiredPendingUploads(user.id);
    await this.assertDirectUploadQuotaAvailable(
      classroom,
      filename,
      input.sizeBytes,
    );

    const pending = await this.prisma.pendingUpload.create({
      data: {
        kind: "classroom",
        workspaceId: classroom.workspaceId,
        classroomId,
        filename,
        mimeType,
        sizeBytes: input.sizeBytes,
        storageKey,
        uploadedBy: user.id,
        expiresAt: new Date(Date.now() + PENDING_UPLOAD_TTL_MS),
      },
    });

    return { uploadId: pending.id, ...upload };
  }

  /** 签名直入第三步:对象校验通过后原子创建文件记录并释放预留。 */
  async confirmFileUpload(
    userId: string | null,
    classroomId: string,
    uploadId: string,
  ) {
    const user = await this.requireUser(userId);
    await this.requireTeacher(user, classroomId);
    const pending = await this.requirePendingUpload(
      user.id,
      uploadId,
      classroomId,
    );
    const classroom = await this.requireClassroom(classroomId);
    const backend = await this.storage.backendFor("oss");

    const stat = await backend.statObject(pending.storageKey).catch(() => null);
    if (!stat) {
      await this.discardPendingUpload(pending);
      throw new BadRequestException("对象存储中未找到已上传的文件,请重新上传");
    }
    if (stat.size !== pending.sizeBytes) {
      await this.discardPendingUpload(pending);
      throw new BadRequestException("上传内容不完整,请重新上传");
    }

    try {
      const record = await this.reserveClassroomFile(
        classroom,
        pending.sizeBytes,
        {
          classroomId,
          storageKey: pending.storageKey,
          storageBackend: "oss",
          filename: pending.filename,
          mimeType: pending.mimeType,
          sizeBytes: pending.sizeBytes,
          uploadedBy: user.id,
        },
      );
      await this.prisma.pendingUpload.delete({ where: { id: pending.id } });
      return {
        ...record,
        createdAt: record.createdAt.toISOString(),
        url: `/classrooms/${classroomId}/files/${record.id}`,
      };
    } catch (caught) {
      await this.discardPendingUpload(pending);
      throw caught;
    }
  }

  /** 客户端取消或失败时释放预留并清理对象;重复调用安全。 */
  async abortFileUpload(
    userId: string | null,
    classroomId: string,
    uploadId: string,
  ) {
    const user = await this.requireUser(userId);
    const pending = await this.prisma.pendingUpload.findUnique({
      where: { id: uploadId },
    });
    if (
      pending &&
      pending.kind === "classroom" &&
      pending.classroomId === classroomId &&
      pending.uploadedBy === user.id
    ) {
      await this.discardPendingUpload(pending);
    }
    return { ok: true as const };
  }

  private async requirePendingUpload(
    userId: string,
    uploadId: string,
    classroomId: string,
  ) {
    const pending = await this.prisma.pendingUpload.findUnique({
      where: { id: uploadId },
    });
    if (
      !pending ||
      pending.kind !== "classroom" ||
      pending.classroomId !== classroomId ||
      pending.uploadedBy !== userId
    ) {
      throw new NotFoundException("上传任务不存在或已完成");
    }
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.discardPendingUpload(pending);
      throw new NotFoundException("上传任务已过期,请重新上传");
    }
    return pending;
  }

  /** 删除预留行并尽力清理对象;直入只签 OSS,因此固定回 OSS 后端。 */
  private async discardPendingUpload(pending: PendingUpload) {
    await this.prisma.pendingUpload
      .delete({ where: { id: pending.id } })
      .catch(() => undefined);
    const backend = await this.storage.backendFor("oss").catch(() => null);
    if (backend) {
      await backend.removeObject(pending.storageKey).catch(() => undefined);
    }
  }

  /** 惰性清理:签名新任务时回收该用户已过期的直入预留。 */
  private async reapExpiredPendingUploads(userId: string) {
    const expired = await this.prisma.pendingUpload.findMany({
      where: { uploadedBy: userId, expiresAt: { lte: new Date() } },
      take: 20,
    });
    for (const pending of expired) {
      await this.discardPendingUpload(pending);
    }
  }

  /** 直入签名的 UX 预检:重名与配额(含未确认的直入预留)。 */
  private async assertDirectUploadQuotaAvailable(
    classroom: {
      id: string;
      workspaceId: string;
      storageQuotaBytes: number | null;
    },
    filename: string,
    incomingBytes: number,
  ) {
    const duplicate = await this.prisma.classroomFile.findFirst({
      where: { classroomId: classroom.id, filename },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException("当前课堂中已存在同名文件");
    }

    const [fileUsage, pendingUsage] = await Promise.all([
      this.prisma.classroomFile.aggregate({
        where: { classroomId: classroom.id },
        _sum: { sizeBytes: true },
      }),
      this.prisma.pendingUpload.aggregate({
        where: {
          classroomId: classroom.id,
          kind: "classroom",
          expiresAt: { gt: new Date() },
        },
        _sum: { sizeBytes: true },
      }),
    ]);
    const quotaBytes =
      classroom.storageQuotaBytes ??
      (await this.getWorkspaceClassroomQuota(classroom.workspaceId));
    const total =
      (fileUsage._sum.sizeBytes ?? 0) +
      (pendingUsage._sum.sizeBytes ?? 0) +
      incomingBytes;
    if (total > quotaBytes) {
      throw new BadRequestException(
        `课堂文件容量不足，当前上限为 ${formatStorageSize(quotaBytes)}`,
      );
    }
  }

  async downloadFile(
    userId: string | null,
    classroomId: string,
    fileId: string,
    forceInline = false,
  ) {
    const user = await this.requireUser(userId);
    await this.requireClassroomAccess(user, classroomId);
    const file = await this.prisma.classroomFile.findFirst({
      where: { id: fileId, classroomId },
    });
    if (!file) throw new NotFoundException("课堂文件不存在");
    if (forceInline && !isSafeInlineAssetMime(file.mimeType)) {
      throw new BadRequestException("该文件类型不支持图片预览");
    }
    const redirectUrl = forceInline
      ? null
      : await this.storage.presignDownload(
          file.storageBackend,
          file.storageKey,
          { filename: file.filename, mimeType: file.mimeType, inline: false },
        );
    if (redirectUrl) {
      return { file, redirectUrl, stream: null };
    }
    const backend = await this.storage.backendFor(file.storageBackend);
    return {
      file,
      inline: forceInline,
      redirectUrl: null,
      stream: (await backend.getObject(file.storageKey)) as Readable,
    };
  }

  async previewFile(
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

    const kind = getAssetPreviewKind(file.filename, file.mimeType);
    if (!kind) {
      throw new BadRequestException("该文件类型不支持在线预览");
    }
    const maxBytes =
      kind === "pdf" ? MAX_PDF_PREVIEW_SIZE_BYTES : MAX_TEXT_PREVIEW_SIZE_BYTES;
    if (file.sizeBytes > maxBytes) {
      throw new BadRequestException(
        kind === "pdf"
          ? "PDF 超过 25MB，请下载后查看"
          : "文本文件超过 2MB，请下载后查看",
      );
    }

    const backend = await this.storage.backendFor(file.storageBackend);
    const stream = (await backend.getObject(file.storageKey)) as Readable;
    const buffer = await readPreviewBuffer(stream, maxBytes);
    if (buffer.length !== file.sizeBytes) {
      throw new BadRequestException("文件内容不完整，无法预览");
    }
    if (kind === "pdf") {
      if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
        throw new BadRequestException("文件内容不是有效的 PDF");
      }
      return { file, kind, content: buffer };
    }

    try {
      const content = new TextDecoder("utf-8", { fatal: true })
        .decode(buffer)
        .replace(/^\uFEFF/, "");
      return { file, kind, content };
    } catch {
      throw new BadRequestException("文本文件必须使用 UTF-8 编码");
    }
  }

  async deleteFile(userId: string | null, classroomId: string, fileId: string) {
    const user = await this.requireUser(userId);
    await this.requireTeacher(user, classroomId);
    const file = await this.prisma.classroomFile.findFirst({
      where: { id: fileId, classroomId },
    });
    if (!file) throw new NotFoundException("课堂文件不存在");
    const backend = await this.storage.backendFor(file.storageBackend);
    await backend.removeObject(file.storageKey);
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

  private async getWorkspaceClassroomQuota(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { classroomStorageQuotaBytes: true },
    });
    return (
      workspace?.classroomStorageQuotaBytes ??
      DEFAULT_CLASSROOM_STORAGE_QUOTA_BYTES
    );
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

  private async reserveClassroomFile(
    classroom: {
      id: string;
      workspaceId: string;
      storageQuotaBytes: number | null;
    },
    incomingBytes: number,
    data: Prisma.ClassroomFileUncheckedCreateInput,
  ) {
    return this.prisma.$transaction(
      async (transaction) => {
        const [workspace, usage] = await Promise.all([
          transaction.workspace.findUnique({
            where: { id: classroom.workspaceId },
            select: { classroomStorageQuotaBytes: true },
          }),
          transaction.classroomFile.aggregate({
            where: { classroomId: classroom.id },
            _sum: { sizeBytes: true },
          }),
        ]);
        const duplicate = await transaction.classroomFile.findFirst({
          where: {
            classroomId: classroom.id,
            filename: data.filename,
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException("当前课堂中已存在同名文件");
        }
        const quotaBytes =
          classroom.storageQuotaBytes ??
          workspace?.classroomStorageQuotaBytes ??
          DEFAULT_CLASSROOM_STORAGE_QUOTA_BYTES;
        if ((usage._sum.sizeBytes ?? 0) + incomingBytes > quotaBytes) {
          throw new BadRequestException(
            `课堂文件容量不足，当前上限为 ${formatStorageSize(quotaBytes)}`,
          );
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

function sanitizeStorageFilename(filename: string) {
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

/** 直入拿不到文件内容,SVG 按扩展名/声明拒绝。 */
function looksLikeSvgDirect(filename: string, declared?: string) {
  return (
    filename.toLowerCase().endsWith(".svg") ||
    declared?.trim().toLowerCase() === "image/svg+xml"
  );
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

function formatStorageSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.floor(bytes / 1024)}KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${Math.floor(bytes / (1024 * 1024))}MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
