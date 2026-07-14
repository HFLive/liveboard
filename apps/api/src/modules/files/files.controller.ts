import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { IsArray, IsIn, IsObject, IsOptional, IsString } from "class-validator";
import type { FileType } from "@liveboard/shared";
import type { ContentBlockType } from "@liveboard/shared";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import {
  AssetsService,
  isSafeInlineAssetMime,
  MAX_ASSET_SIZE_BYTES,
  type UploadedAssetFile,
} from "./assets.service";
import { FilesService } from "./files.service";
import { MAX_MARKDOWN_SIZE_BYTES } from "./markdown";

class CreateFolderDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

class CreateFileDto {
  @IsString()
  folderId!: string;

  @IsString()
  title!: string;

  @IsIn(["book", "lesson", "course", "exercise_set", "doc", "asset"])
  type!: FileType;
}

class UpdateFolderDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

class UpdateFileDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  folderId?: string;
}

class CreateBlockDto {
  @IsIn([
    "heading_1",
    "heading_2",
    "heading_3",
    "heading_4",
    "heading_5",
    "heading_6",
    "paragraph",
    "bulleted_list",
    "numbered_list",
    "todo",
    "code",
    "quote",
    "image",
    "attachment",
    "divider",
    "reference",
    "question",
    "table",
    "math",
  ])
  type!: ContentBlockType;

  @IsObject()
  dataJson!: Record<string, unknown>;
}

class UpdateBlockDto {
  @IsOptional()
  @IsIn([
    "heading_1",
    "heading_2",
    "heading_3",
    "heading_4",
    "heading_5",
    "heading_6",
    "paragraph",
    "bulleted_list",
    "numbered_list",
    "todo",
    "code",
    "quote",
    "image",
    "attachment",
    "divider",
    "reference",
    "question",
    "table",
    "math",
  ])
  type?: ContentBlockType;

  @IsObject()
  dataJson!: Record<string, unknown>;
}

class ReferenceBlocksDto {
  @IsArray()
  @IsString({ each: true })
  sourceBlockIds!: string[];
}

class ReorderBlocksDto {
  @IsArray()
  @IsString({ each: true })
  blockIds!: string[];
}

class UploadAssetDto {
  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  fileId?: string;
}

class ImportMarkdownDto {
  @IsString()
  folderId!: string;
}

interface UploadedMarkdownFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller()
export class FilesController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly filesService: FilesService,
  ) {}

  @Get("folders/tree")
  async folderTree(@CurrentUserId() userId: string | null) {
    return { folders: await this.filesService.getFolderTree(userId) };
  }

  @Post("folders")
  async createFolder(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateFolderDto,
  ) {
    return { folder: await this.filesService.createFolder(userId, body) };
  }

  @Patch("folders/:id")
  async updateFolder(
    @CurrentUserId() userId: string | null,
    @Param("id") folderId: string,
    @Body() body: UpdateFolderDto,
  ) {
    return {
      folder: await this.filesService.updateFolder(userId, folderId, body),
    };
  }

  @Delete("folders/:id")
  async deleteFolder(
    @CurrentUserId() userId: string | null,
    @Param("id") folderId: string,
  ) {
    return this.filesService.deleteFolder(userId, folderId);
  }

  @Get("files")
  async listFiles(
    @CurrentUserId() userId: string | null,
    @Query("folderId") folderId?: string,
  ) {
    return {
      files: await this.filesService.listFiles(userId, {
        folderId,
      }),
    };
  }

  @Get("files/:id")
  async getFile(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
  ) {
    return { file: await this.filesService.getFile(userId, fileId) };
  }

  @Post("files")
  async createFile(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateFileDto,
  ) {
    return { file: await this.filesService.createFile(userId, body) };
  }

  @Post("files/import/markdown")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_MARKDOWN_SIZE_BYTES, files: 1 },
    }),
  )
  async importMarkdown(
    @CurrentUserId() userId: string | null,
    @Body() body: ImportMarkdownDto,
    @UploadedFile() file?: UploadedMarkdownFile,
  ) {
    if (!file) {
      return this.filesService.importMarkdown(userId, {
        folderId: body.folderId,
        originalname: "",
        size: 0,
        buffer: Buffer.alloc(0),
      });
    }

    return this.filesService.importMarkdown(userId, {
      folderId: body.folderId,
      originalname: file.originalname,
      size: file.size,
      buffer: file.buffer,
    });
  }

  @Get("files/:id/export/markdown")
  async exportMarkdown(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
    @Res() response: Response,
  ) {
    const result = await this.filesService.exportMarkdown(userId, fileId);
    const encodedFilename = encodeURIComponent(result.filename);
    response.setHeader("Content-Type", "text/markdown; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="content.md"; filename*=UTF-8''${encodedFilename}`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(result.content);
  }

  @Patch("files/:id")
  async updateFile(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
    @Body() body: UpdateFileDto,
  ) {
    return { file: await this.filesService.updateFile(userId, fileId, body) };
  }

  @Post("files/:id/publish")
  async publishFile(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
  ) {
    return { file: await this.filesService.publishFile(userId, fileId) };
  }

  @Delete("files/:id")
  async deleteFile(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
  ) {
    return this.filesService.deleteFile(userId, fileId);
  }

  @Get("files/:id/blocks")
  async listBlocks(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
  ) {
    return { blocks: await this.filesService.listBlocks(userId, fileId) };
  }

  @Post("files/:id/blocks")
  async createBlock(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
    @Body() body: CreateBlockDto,
  ) {
    return { block: await this.filesService.createBlock(userId, fileId, body) };
  }

  @Post("files/:id/reference-blocks")
  async referenceBlocks(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
    @Body() body: ReferenceBlocksDto,
  ) {
    return {
      blocks: await this.filesService.referenceBlocks(userId, fileId, body),
    };
  }

  @Patch("files/:id/blocks/reorder")
  async reorderBlocks(
    @CurrentUserId() userId: string | null,
    @Param("id") fileId: string,
    @Body() body: ReorderBlocksDto,
  ) {
    return {
      blocks: await this.filesService.reorderBlocks(userId, fileId, body),
    };
  }

  @Post("assets/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_ASSET_SIZE_BYTES, files: 1 },
    }),
  )
  async uploadAsset(
    @CurrentUserId() userId: string | null,
    @Body() body: UploadAssetDto,
    @UploadedFile() file?: UploadedAssetFile,
  ) {
    return {
      asset: await this.assetsService.uploadAsset(userId, body, file),
    };
  }

  @Get("assets/library")
  async listLibraryAssets(@CurrentUserId() userId: string | null) {
    return {
      assets: await this.assetsService.listLibraryAssets(userId),
    };
  }

  @Delete("assets/:id")
  async deleteAsset(
    @CurrentUserId() userId: string | null,
    @Param("id") assetId: string,
  ) {
    return this.assetsService.deleteLibraryAsset(userId, assetId);
  }

  @Get("assets/:id")
  async getAsset(
    @CurrentUserId() userId: string | null,
    @Param("id") assetId: string,
    @Res() res: Response,
  ) {
    const { asset, stream } = await this.assetsService.getAssetForDownload(
      userId,
      assetId,
    );

    const inline = isSafeInlineAssetMime(asset.mimeType);
    res.setHeader(
      "Content-Type",
      inline ? asset.mimeType : "application/octet-stream",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (!inline) res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(asset.filename)}"`,
    );
    stream.pipe(res);
  }

  @Patch("blocks/:id")
  async updateBlock(
    @CurrentUserId() userId: string | null,
    @Param("id") blockId: string,
    @Body() body: UpdateBlockDto,
  ) {
    return {
      block: await this.filesService.updateBlock(userId, blockId, body),
    };
  }

  @Delete("blocks/:id")
  async deleteBlock(
    @CurrentUserId() userId: string | null,
    @Param("id") blockId: string,
  ) {
    return this.filesService.deleteBlock(userId, blockId);
  }
}
