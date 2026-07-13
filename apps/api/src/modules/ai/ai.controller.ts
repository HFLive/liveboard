import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { AiService } from "./ai.service";

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
  message!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}

@Controller()
export class AiController {
  constructor(private readonly aiService: AiService) {}

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
    return this.aiService.ask(userId, body);
  }

  @Post("ai/ask/stream")
  @HttpCode(200)
  async askStream(
    @CurrentUserId() userId: string | null,
    @Body() body: AskAiDto,
    @Res() res: Response,
  ) {
    const prepared = await this.aiService.prepareQuestion(userId, body.message);
    const turn = await this.aiService.createConversationTurn(
      userId,
      prepared.question,
      body.conversationId,
      prepared.settings,
    );

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    writeStreamEvent(res, {
      type: "conversation",
      conversation: {
        id: turn.conversation.id,
        title: turn.conversation.title,
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
    writeStreamEvent(res, { type: "sources", sources: prepared.sources });

    let answer = "";
    try {
      await this.aiService.streamChatCompletion(prepared, (delta) => {
        answer += delta;
        writeStreamEvent(res, { type: "delta", delta });
      });
      const assistantMessage = await this.aiService.saveAssistantMessage(
        turn.conversation.id,
        answer,
        prepared.sources,
      );
      writeStreamEvent(res, {
        type: "message",
        message: {
          id: assistantMessage.id,
          role: assistantMessage.role,
          content: assistantMessage.content,
          sources: prepared.sources,
          createdAt: assistantMessage.createdAt.toISOString(),
        },
      });
      writeStreamEvent(res, { type: "done" });
    } catch (caught) {
      if (answer) {
        await this.aiService.saveAssistantMessage(
          turn.conversation.id,
          `${answer}\n\n（生成中断）`,
          prepared.sources,
        );
      }
      const message =
        caught instanceof Error ? caught.message : "AI 流式请求失败";
      writeStreamEvent(res, { type: "error", message });
    } finally {
      res.end();
    }
  }
}

function writeStreamEvent(res: Response, event: unknown) {
  res.write(`${JSON.stringify(event)}\n`);
}
