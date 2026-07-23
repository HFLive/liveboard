import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { AiService } from "./ai.service";
import { AiRateLimitService } from "./ai-rate-limit.service";

class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxContextFiles?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(40000)
  maxContextChars?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultCallLimit?: number;
}

class CreateAiProviderConfigDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  providerName!: string;

  @IsString()
  @MinLength(1)
  baseUrl!: string;

  @IsString()
  @MinLength(1)
  model!: string;

  @IsString()
  @MinLength(1)
  apiKey!: string;
}

class UpdateAiProviderConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  providerName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  model?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;
}

class AskAiDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}

class UpdateAiConversationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

@Controller()
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly rateLimit: AiRateLimitService,
  ) {}

  @Get("admin/ai/settings")
  async getSettings(@CurrentUserId() userId: string | null) {
    return { settings: await this.aiService.getSettings(userId) };
  }

  @Patch("admin/ai/settings")
  async updateSettings(
    @CurrentUserId() userId: string | null,
    @Body() body: UpdateAiSettingsDto,
  ) {
    return { settings: await this.aiService.updateSettings(userId, body) };
  }

  @Post("admin/ai/configs")
  async createProviderConfig(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateAiProviderConfigDto,
  ) {
    return {
      config: await this.aiService.createProviderConfig(userId, body),
    };
  }

  @Patch("admin/ai/configs/:id")
  async updateProviderConfig(
    @CurrentUserId() userId: string | null,
    @Param("id") configId: string,
    @Body() body: UpdateAiProviderConfigDto,
  ) {
    return {
      config: await this.aiService.updateProviderConfig(userId, configId, body),
    };
  }

  @Post("admin/ai/configs/:id/activate")
  @HttpCode(200)
  async activateProviderConfig(
    @CurrentUserId() userId: string | null,
    @Param("id") configId: string,
  ) {
    return {
      settings: await this.aiService.activateProviderConfig(userId, configId),
    };
  }

  @Delete("admin/ai/configs/:id")
  async deleteProviderConfig(
    @CurrentUserId() userId: string | null,
    @Param("id") configId: string,
  ) {
    return this.aiService.deleteProviderConfig(userId, configId);
  }

  @Get("ai/status")
  async status(@CurrentUserId() userId: string | null) {
    return { status: await this.aiService.getAvailability(userId) };
  }

  @Get("ai/usage")
  async usage(@CurrentUserId() userId: string | null) {
    return { usage: await this.aiService.getUsage(userId) };
  }

  @Get("ai/conversations")
  async conversations(@CurrentUserId() userId: string | null) {
    return { conversations: await this.aiService.listConversations(userId) };
  }

  @Get("ai/conversations/:id")
  async conversation(
    @CurrentUserId() userId: string | null,
    @Param("id") conversationId: string,
  ) {
    return {
      conversation: await this.aiService.getConversation(
        userId,
        conversationId,
      ),
    };
  }

  @Patch("ai/conversations/:id")
  async updateConversation(
    @CurrentUserId() userId: string | null,
    @Param("id") conversationId: string,
    @Body() body: UpdateAiConversationDto,
  ) {
    return {
      conversation: await this.aiService.updateConversation(
        userId,
        conversationId,
        body,
      ),
    };
  }

  @Delete("ai/conversations/:id")
  async deleteConversation(
    @CurrentUserId() userId: string | null,
    @Param("id") conversationId: string,
  ) {
    return this.aiService.deleteConversation(userId, conversationId);
  }

  @Post("ai/ask")
  @HttpCode(200)
  async ask(@CurrentUserId() userId: string | null, @Body() body: AskAiDto) {
    const release = await this.rateLimit.acquire(userId);
    try {
      return await this.aiService.ask(userId, body);
    } finally {
      await release();
    }
  }

  @Post("ai/ask/stream")
  @HttpCode(200)
  async askStream(
    @CurrentUserId() userId: string | null,
    @Body() body: AskAiDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const release = await this.rateLimit.acquire(userId);
    const abortController = new AbortController();
    const abortOnDisconnect = () => {
      if (!res.writableEnded) abortController.abort();
    };
    req.once("aborted", abortOnDisconnect);
    res.once("close", abortOnDisconnect);
    try {
      const prepared = await this.aiService.prepareQuestion(
        userId,
        body.message,
        body.conversationId,
      );
      const turn = await this.aiService.createConversationTurn(
        userId,
        prepared.question,
        body.conversationId,
        prepared.settings,
        abortController.signal,
      );

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      writeStreamEvent(res, {
        type: "conversation",
        conversation: {
          id: turn.conversation.id,
          title: turn.conversation.title,
          pinned: false,
          createdAt: turn.conversation.createdAt.toISOString(),
          updatedAt: new Date().toISOString(),
        },
        userMessage: {
          id: turn.userMessage.id,
          role: "user",
          content: turn.userMessage.content,
          createdAt: turn.userMessage.createdAt.toISOString(),
        },
      });
      let answer = "";
      try {
        await this.aiService.streamChatCompletion(
          prepared,
          (delta) => {
            answer += delta;
            if (!res.destroyed) writeStreamEvent(res, { type: "delta", delta });
          },
          abortController.signal,
        );
        const finalized = this.aiService.finalizeGeneratedAnswer(
          answer,
          prepared.sources,
        );
        const assistantMessage = await this.aiService.saveAssistantMessage(
          turn.conversation.id,
          finalized.answer,
          finalized.sources,
        );
        if (!res.destroyed) {
          writeStreamEvent(res, {
            type: "message",
            message: {
              id: assistantMessage.id,
              role: assistantMessage.role,
              content: assistantMessage.content,
              sources: finalized.sources,
              createdAt: assistantMessage.createdAt.toISOString(),
            },
          });
          writeStreamEvent(res, { type: "done" });
        }
      } catch (caught) {
        if (answer) {
          const finalized = this.aiService.finalizeGeneratedAnswer(
            `${answer}\n\n（生成中断）`,
            prepared.sources,
          );
          await this.aiService.saveAssistantMessage(
            turn.conversation.id,
            finalized.answer,
            finalized.sources,
          );
        }
        if (!res.destroyed) {
          const message =
            caught instanceof Error ? caught.message : "AI 流式请求失败";
          writeStreamEvent(res, { type: "error", message });
        }
      } finally {
        if (!res.destroyed && !res.writableEnded) res.end();
      }
    } finally {
      req.off("aborted", abortOnDisconnect);
      res.off("close", abortOnDisconnect);
      await release();
    }
  }
}

function writeStreamEvent(res: Response, event: unknown) {
  res.write(`${JSON.stringify(event)}\n`);
}
