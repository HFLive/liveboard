import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import {
  CreateClassroomAnnouncementDto,
  CreateClassroomDto,
  UpdateClassroomAnnouncementDto,
  UpdateClassroomDto,
  UpsertClassroomMemberDto,
} from "./classrooms.dto";
import {
  ClassroomsService,
  MAX_CLASSROOM_FILE_SIZE_BYTES,
  type UploadedClassroomFile,
} from "./classrooms.service";

@Controller("classrooms")
export class ClassroomsController {
  constructor(private readonly classroomsService: ClassroomsService) {}

  @Get()
  async list(@CurrentUserId() userId: string | null) {
    return { classrooms: await this.classroomsService.list(userId) };
  }

  @Post()
  async create(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateClassroomDto,
  ) {
    return { classroom: await this.classroomsService.create(userId, body) };
  }

  @Get(":id")
  async get(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
  ) {
    return {
      classroom: await this.classroomsService.get(userId, classroomId),
    };
  }

  @Patch(":id")
  async update(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Body() body: UpdateClassroomDto,
  ) {
    return {
      classroom: await this.classroomsService.update(userId, classroomId, body),
    };
  }

  @Delete(":id")
  async delete(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
  ) {
    return this.classroomsService.delete(userId, classroomId);
  }

  @Post(":id/announcements")
  async createAnnouncement(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Body() body: CreateClassroomAnnouncementDto,
  ) {
    return {
      announcement: await this.classroomsService.createAnnouncement(
        userId,
        classroomId,
        body,
      ),
    };
  }

  @Patch(":id/announcements/:announcementId")
  async updateAnnouncement(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Param("announcementId") announcementId: string,
    @Body() body: UpdateClassroomAnnouncementDto,
  ) {
    return {
      announcement: await this.classroomsService.updateAnnouncement(
        userId,
        classroomId,
        announcementId,
        body,
      ),
    };
  }

  @Delete(":id/announcements/:announcementId")
  async deleteAnnouncement(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Param("announcementId") announcementId: string,
  ) {
    return this.classroomsService.deleteAnnouncement(
      userId,
      classroomId,
      announcementId,
    );
  }

  @Put(":id/members/:memberUserId")
  async upsertMember(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Param("memberUserId") memberUserId: string,
    @Body() body: UpsertClassroomMemberDto,
  ) {
    return {
      classroom: await this.classroomsService.upsertMember(
        userId,
        classroomId,
        memberUserId,
        body.role,
      ),
    };
  }

  @Delete(":id/members/:memberUserId")
  async removeMember(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Param("memberUserId") memberUserId: string,
  ) {
    return {
      classroom: await this.classroomsService.removeMember(
        userId,
        classroomId,
        memberUserId,
      ),
    };
  }

  @Get(":id/files")
  async listFiles(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
  ) {
    return {
      files: await this.classroomsService.listFiles(userId, classroomId),
    };
  }

  @Post(":id/files")
  @UseInterceptors(
    FileInterceptor("file", {
      defParamCharset: "utf8",
      limits: { fileSize: MAX_CLASSROOM_FILE_SIZE_BYTES, files: 1 },
    }),
  )
  async uploadFile(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @UploadedFile() file?: UploadedClassroomFile,
  ) {
    return {
      file: await this.classroomsService.uploadFile(userId, classroomId, file),
    };
  }

  @Get(":id/files/:fileId")
  async downloadFile(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Param("fileId") fileId: string,
    @Res() response: Response,
  ) {
    const { file, stream, redirectUrl } =
      await this.classroomsService.downloadFile(userId, classroomId, fileId);
    if (redirectUrl) {
      response.redirect(302, redirectUrl);
      return;
    }
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "sandbox");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file.filename)}"`,
    );
    stream!.pipe(response);
  }

  @Delete(":id/files/:fileId")
  async deleteFile(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Param("fileId") fileId: string,
  ) {
    return this.classroomsService.deleteFile(userId, classroomId, fileId);
  }
}
