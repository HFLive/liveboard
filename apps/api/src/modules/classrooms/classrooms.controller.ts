import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import {
  PRIVATE_IMMUTABLE_CACHE_CONTROL,
  PRIVATE_NO_STORE_CACHE_CONTROL,
} from "../../common/cache-control";
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
import { createRequestAbortSignal } from "../../common/request-abort";

class SignFileUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  filename!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;
}

class ConfirmFileUploadDto {
  @IsString()
  @IsNotEmpty()
  uploadId!: string;
}

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
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @UploadedFile() file?: UploadedClassroomFile,
  ) {
    const requestAbort = createRequestAbortSignal(request, response);
    try {
      return {
        file: await this.classroomsService.uploadFile(
          userId,
          classroomId,
          file,
          requestAbort.signal,
        ),
      };
    } finally {
      requestAbort.dispose();
    }
  }

  @Post(":id/files/upload-url")
  async signFileUpload(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Body() body: SignFileUploadDto,
  ) {
    return this.classroomsService.signFileUpload(userId, classroomId, body);
  }

  @Post(":id/files/upload-confirm")
  async confirmFileUpload(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Body() body: ConfirmFileUploadDto,
  ) {
    return {
      file: await this.classroomsService.confirmFileUpload(
        userId,
        classroomId,
        body.uploadId,
      ),
    };
  }

  @Post(":id/files/upload-abort")
  async abortFileUpload(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Body() body: ConfirmFileUploadDto,
  ) {
    return this.classroomsService.abortFileUpload(
      userId,
      classroomId,
      body.uploadId,
    );
  }

  @Get(":id/files/:fileId")
  async downloadFile(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Param("fileId") fileId: string,
    @Res() response: Response,
    @Query("inline") inline?: string,
  ) {
    const forceInline = inline === "1";
    const { file, stream, redirectUrl } =
      await this.classroomsService.downloadFile(
        userId,
        classroomId,
        fileId,
        forceInline,
      );
    if (redirectUrl) {
      response.setHeader("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
      response.redirect(302, redirectUrl);
      return;
    }
    response.setHeader(
      "Content-Type",
      forceInline ? file.mimeType : "application/octet-stream",
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Cross-Origin-Resource-Policy",
      forceInline ? "same-site" : "same-origin",
    );
    response.setHeader("Content-Security-Policy", "sandbox");
    response.setHeader(
      "Content-Disposition",
      `${forceInline ? "inline" : "attachment"}; filename="${encodeURIComponent(
        file.filename,
      )}"`,
    );
    response.setHeader("Content-Length", String(file.sizeBytes));
    response.setHeader(
      "Cache-Control",
      forceInline
        ? PRIVATE_IMMUTABLE_CACHE_CONTROL
        : PRIVATE_NO_STORE_CACHE_CONTROL,
    );
    stream!.pipe(response);
  }

  @Get(":id/files/:fileId/preview-url")
  async filePreviewUrl(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Param("fileId") fileId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    // 直传 URL 是一次性短期签名，浏览器拿去流式加载 PDF，不能缓存。
    response.setHeader("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
    return {
      url: await this.classroomsService.getFilePreviewUrl(
        userId,
        classroomId,
        fileId,
      ),
    };
  }

  @Get(":id/files/:fileId/preview")
  async previewFile(
    @CurrentUserId() userId: string | null,
    @Param("id") classroomId: string,
    @Param("fileId") fileId: string,
    @Res() response: Response,
  ) {
    const { kind, content } = await this.classroomsService.previewFile(
      userId,
      classroomId,
      fileId,
    );
    response.setHeader(
      "Content-Type",
      kind === "pdf"
        ? "application/pdf"
        : kind === "markdown"
          ? "text/markdown; charset=utf-8"
          : "text/plain; charset=utf-8",
    );
    response.setHeader("Content-Disposition", "inline");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    response.setHeader("Content-Security-Policy", "sandbox");
    response.setHeader("Cache-Control", PRIVATE_IMMUTABLE_CACHE_CONTROL);
    response.send(content);
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
