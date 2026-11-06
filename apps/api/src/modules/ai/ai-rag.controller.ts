import { Body, Controller, Get, HttpCode, Patch, Post } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { AiRagService } from "./ai-rag.service";

class UpdateRetrievalDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  providerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  apiKey?: string;
}

class SyncRetrievalDto {
  @IsOptional()
  @IsBoolean()
  retryFailures?: boolean;
}

@Controller("admin/ai/retrieval")
export class AiRagController {
  constructor(private readonly rag: AiRagService) {}

  @Get()
  async settings(@CurrentUserId() userId: string | null) {
    return { retrieval: await this.rag.getSettings(userId) };
  }

  @Patch()
  async update(
    @CurrentUserId() userId: string | null,
    @Body() body: UpdateRetrievalDto,
  ) {
    return { retrieval: await this.rag.updateSettings(userId, body) };
  }

  @Post("sync")
  @HttpCode(202)
  async sync(
    @CurrentUserId() userId: string | null,
    @Body() body: SyncRetrievalDto,
  ) {
    return this.rag.retryIndex(userId, body.retryFailures);
  }
}
