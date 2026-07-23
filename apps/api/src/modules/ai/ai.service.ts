import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { canView, isSuperAdmin } from "@liveboard/shared";
import type { Prisma } from "@prisma/client";
import { formatDateKey } from "../../common/date-key";
import { requireResourceName } from "../../common/resource-name";
import { PermissionsService } from "../permissions/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import { rankRetrievalFiles } from "./ai-retrieval";
import { AiSecretService } from "./ai-secret.service";

interface UpdateAiSettingsInput {
  enabled?: boolean;
  maxContextFiles?: number;
  maxContextChars?: number;
  defaultCallLimit?: number;
}

interface AiProviderConfigInput {
  name?: string;
  providerName?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

const AI_COMPLETION_TEMPERATURE = 0.2;

interface AskAiInput {
  message: string;
  conversationId?: string;
}

interface AiSourceSummary {
  id: string;
  title: string;
  type: string;
  updatedAt: string;
  unavailable?: boolean;
  blocks: Array<{
    id: string;
    type: string;
    text: string;
  }>;
}

interface ContextFile {
  id: string;
  title: string;
  type: string;
  updatedAt: Date;
  text: string;
  score: number;
  blocks: ContextBlock[];
}

interface ContextBlock {
  id: string;
  type: string;
  text: string;
  sortOrder: number;
}

interface AiConversationHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface PreparedAiQuestion {
  settings: AiCompletionSettings;
  question: string;
  contextText: string;
  sources: AiSourceSummary[];
  conversationHistory: AiConversationHistoryMessage[];
}

interface AiCompletionSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
}

interface PreparedConversationTurn {
  conversation: {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
  };
  userMessage: {
    id: string;
    content: string;
    createdAt: Date;
  };
}

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly secrets: AiSecretService,
  ) {}

  async getSettings(userId: string | null) {
    await this.ensureAdmin(userId);
    const settings = await this.getOrCreateSettings();
    const configs = await this.listStoredConfigs(settings.workspaceId);
    return this.toPublicSettings(settings, configs);
  }

  async getAvailability(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const settings = await this.getOrCreateSettings();
    const activeConfig = settings.activeConfig;
    const configured = Boolean(
      activeConfig?.baseUrl && activeConfig.model && activeConfig.apiKey,
    );
    const available = settings.enabled && configured;

    return {
      available,
      enabled: settings.enabled,
      configured,
      reason: available
        ? null
        : settings.enabled
          ? "AI 配置尚未完成，请联系管理员"
          : "管理员尚未开启 AI 功能",
    };
  }

  async consumeCallQuota(userId: string) {
    // 所有 AI 调用入口的统一配额消耗点：后续其他功能调用 AI 前也必须先调用此方法，
    // 保证每次向 AI 提问恰好消耗一次调用次数。
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        aiCallCount: true,
        aiCallLimit: true,
        aiCallDateKey: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("Missing session");
    }

    const settings = await this.getOrCreateSettings();
    const effectiveLimit = user.aiCallLimit ?? settings.defaultCallLimit;
    const dateKey = formatDateKey(new Date(), settings.workspaceTimeZone);

    if (user.aiCallDateKey !== dateKey) {
      await this.prisma.user.updateMany({
        where: {
          id: userId,
          OR: [{ aiCallDateKey: null }, { aiCallDateKey: { not: dateKey } }],
        },
        data: { aiCallCount: 0, aiCallDateKey: dateKey },
      });
    }

    const consumed = await this.prisma.user.updateMany({
      where: {
        id: userId,
        aiCallDateKey: dateKey,
        aiCallCount: { lt: effectiveLimit },
      },
      data: { aiCallCount: { increment: 1 } },
    });

    if (consumed.count === 0) {
      throw new HttpException("今日 AI 调用次数已达上限，明日自动恢复", 429);
    }
  }

  async getUsage(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        aiCallCount: true,
        aiCallLimit: true,
        aiCallDateKey: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("Missing session");
    }

    const settings = await this.getOrCreateSettings();
    const dateKey = formatDateKey(new Date(), settings.workspaceTimeZone);

    return {
      used: user.aiCallDateKey === dateKey ? user.aiCallCount : 0,
      limit: user.aiCallLimit ?? settings.defaultCallLimit,
    };
  }

  async updateSettings(userId: string | null, input: UpdateAiSettingsInput) {
    await this.ensureAdmin(userId);

    const settings = await this.getOrCreateSettings();
    const data: Prisma.AiSettingsUpdateInput = {};

    if (input.enabled !== undefined) {
      data.enabled = input.enabled;
    }

    if (input.maxContextFiles !== undefined) {
      data.maxContextFiles = input.maxContextFiles;
    }

    if (input.maxContextChars !== undefined) {
      data.maxContextChars = input.maxContextChars;
    }

    if (input.defaultCallLimit !== undefined) {
      if (
        !Number.isInteger(input.defaultCallLimit) ||
        input.defaultCallLimit < 0
      ) {
        throw new BadRequestException("每日默认 AI 调用限额必须是非负整数");
      }
      data.defaultCallLimit = input.defaultCallLimit;
    }

    data.updatedById = userId;

    const updated = await this.prisma.aiSettings.update({
      where: { id: settings.id },
      data,
      include: { activeConfig: true },
    });

    const configs = await this.listStoredConfigs(settings.workspaceId);
    return this.toPublicSettings(updated, configs);
  }

  async createProviderConfig(
    userId: string | null,
    input: Required<AiProviderConfigInput>,
  ) {
    await this.ensureAdmin(userId);
    const workspace = await this.getDefaultWorkspace();
    const name = normalizeConfigName(input.name);
    await this.ensureUniqueConfigName(workspace.id, name);

    const config = await this.prisma.aiProviderConfig.create({
      data: {
        workspaceId: workspace.id,
        name,
        providerName: normalizeProviderName(input.providerName),
        baseUrl: normalizeBaseUrl(input.baseUrl),
        model: normalizeModel(input.model),
        apiKey: this.secrets.encrypt(normalizeApiKey(input.apiKey, true)),
      },
    });

    return this.toPublicProviderConfig(config);
  }

  async updateProviderConfig(
    userId: string | null,
    configId: string,
    input: AiProviderConfigInput,
  ) {
    await this.ensureAdmin(userId);
    const config = await this.getWorkspaceConfig(configId);
    const data: Prisma.AiProviderConfigUpdateInput = {};

    if (input.name !== undefined) {
      const name = normalizeConfigName(input.name);
      await this.ensureUniqueConfigName(config.workspaceId, name, config.id);
      data.name = name;
    }

    if (input.providerName !== undefined) {
      data.providerName = normalizeProviderName(input.providerName);
    }

    if (input.baseUrl !== undefined) {
      data.baseUrl = normalizeBaseUrl(input.baseUrl);
    }

    if (input.model !== undefined) {
      data.model = normalizeModel(input.model);
    }

    if (input.apiKey !== undefined && input.apiKey.trim()) {
      data.apiKey = this.secrets.encrypt(normalizeApiKey(input.apiKey, true));
    }

    const updated = await this.prisma.aiProviderConfig.update({
      where: { id: config.id },
      data,
    });

    return this.toPublicProviderConfig(updated);
  }

  async activateProviderConfig(userId: string | null, configId: string) {
    await this.ensureAdmin(userId);
    const config = await this.getWorkspaceConfig(configId);
    ensureCompleteConfig(config);
    const settings = await this.getOrCreateSettings();

    const updated = await this.prisma.aiSettings.update({
      where: { id: settings.id },
      data: { activeConfigId: config.id, updatedById: userId },
      include: { activeConfig: true },
    });
    const configs = await this.listStoredConfigs(settings.workspaceId);

    return this.toPublicSettings(updated, configs);
  }

  async deleteProviderConfig(userId: string | null, configId: string) {
    await this.ensureAdmin(userId);
    const config = await this.getWorkspaceConfig(configId);
    const settings = await this.getOrCreateSettings();

    if (settings.activeConfigId === config.id) {
      throw new BadRequestException("请先切换当前配置，再删除该配置");
    }

    await this.prisma.aiProviderConfig.delete({ where: { id: config.id } });
    return { ok: true };
  }

  async listConversations(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const conversations = await this.prisma.aiConversation.findMany({
      where: { userId },
      orderBy: [{ pinnedAt: "desc" }, { updatedAt: "desc" }],
      take: 40,
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      pinned: Boolean(conversation.pinnedAt),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessagePreview: conversation.messages[0]?.content.slice(0, 80) ?? "",
    }));
  }

  async getConversation(userId: string | null, conversationId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversation || conversation.userId !== userId) {
      throw new ForbiddenException("No permission to view AI conversation");
    }

    const parsedMessages = conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sources: parseSources(message.sourcesJson),
      createdAt: message.createdAt.toISOString(),
    }));
    const sourceIds = [
      ...new Set(
        parsedMessages.flatMap((message) =>
          message.sources.map((source) => source.id),
        ),
      ),
    ];
    const files = await this.prisma.file.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, status: true },
    });
    const permissions = await this.permissions.getEffectiveLevelsForFiles(
      userId,
      files.map((file) => file.id),
    );
    const availableSourceIds = new Set(
      files
        .filter((file) => {
          const permission = permissions.get(file.id) ?? null;
          return (
            file.status !== "archived" &&
            canView(permission) &&
            !(file.status === "draft" && permission === "viewer")
          );
        })
        .map((file) => file.id),
    );

    return {
      id: conversation.id,
      title: conversation.title,
      pinned: Boolean(conversation.pinnedAt),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: parsedMessages.map((message) => ({
        ...message,
        sources: message.sources.map((source) =>
          availableSourceIds.has(source.id)
            ? source
            : { ...source, unavailable: true },
        ),
      })),
    };
  }

  async deleteConversation(userId: string | null, conversationId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation || conversation.userId !== userId) {
      throw new ForbiddenException("No permission to delete AI conversation");
    }

    await this.prisma.aiConversation.delete({ where: { id: conversationId } });
    return { ok: true };
  }

  async updateConversation(
    userId: string | null,
    conversationId: string,
    input: { title?: string; pinned?: boolean },
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation || conversation.userId !== userId) {
      throw new ForbiddenException("No permission to update AI conversation");
    }

    const title =
      input.title === undefined
        ? undefined
        : requireResourceName(input.title, "对话名称");
    const updated = await this.prisma.aiConversation.update({
      where: { id: conversationId },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(input.pinned !== undefined
          ? { pinnedAt: input.pinned ? new Date() : null }
          : {}),
      },
    });

    return {
      id: updated.id,
      title: updated.title,
      pinned: Boolean(updated.pinnedAt),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async ask(userId: string | null, input: AskAiInput) {
    const prepared = await this.prepareQuestion(
      userId,
      input.message,
      input.conversationId,
    );
    const turn = await this.createConversationTurn(
      userId,
      prepared.question,
      input.conversationId,
      prepared.settings,
    );
    const generatedAnswer = await this.callChatCompletion(
      prepared.settings,
      prepared.question,
      prepared.contextText,
      prepared.conversationHistory,
    );
    const { answer, sources } = this.finalizeGeneratedAnswer(
      generatedAnswer,
      prepared.sources,
    );
    const assistantMessage = await this.saveAssistantMessage(
      turn.conversation.id,
      answer,
      sources,
    );

    return {
      conversation: this.toConversationSummary({
        ...turn.conversation,
        updatedAt: new Date(),
      }),
      userMessage: this.toMessageSummary({
        ...turn.userMessage,
        role: "user",
        sourcesJson: null,
      }),
      assistantMessage: this.toMessageSummary(assistantMessage),
      answer,
      sources,
    };
  }

  async prepareQuestion(
    userId: string | null,
    message: string,
    conversationId?: string,
  ): Promise<PreparedAiQuestion> {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const question = message.trim();
    if (!question) {
      throw new BadRequestException("请输入问题");
    }

    const settings = await this.getOrCreateSettings();
    const activeConfig = settings.activeConfig;

    if (!settings.enabled) {
      throw new ServiceUnavailableException("AI 助手尚未启用");
    }

    if (!activeConfig) {
      throw new ServiceUnavailableException("尚未选择 AI 配置，请联系管理员");
    }

    if (!activeConfig.baseUrl || !activeConfig.model || !activeConfig.apiKey) {
      throw new ServiceUnavailableException("AI 配置不完整，请联系管理员");
    }

    await this.consumeCallQuota(userId);

    const conversationHistory = conversationId
      ? await this.getRecentConversationHistory(userId, conversationId)
      : [];
    const retrievalQuery = buildRetrievalQuery(question, conversationHistory);
    const contextFiles = isConversationalPrompt(question)
      ? []
      : await this.buildContext(userId, retrievalQuery, {
          maxFiles: settings.maxContextFiles,
          maxChars: settings.maxContextChars,
        });
    const contextText = contextFiles
      .map((file, index) =>
        [
          `资料 ${index + 1}: ${file.title}`,
          `更新时间: ${file.updatedAt.toISOString()}`,
          file.text,
        ].join("\n"),
      )
      .join("\n\n---\n\n");

    return {
      settings: {
        baseUrl: activeConfig.baseUrl,
        model: activeConfig.model,
        apiKey: activeConfig.apiKey,
        temperature: AI_COMPLETION_TEMPERATURE,
      },
      question,
      contextText,
      conversationHistory,
      sources: contextFiles.map((file) => ({
        id: file.id,
        title: file.title,
        type: file.type,
        updatedAt: file.updatedAt.toISOString(),
        blocks: file.blocks.slice(0, 4).map((block) => ({
          id: block.id,
          type: block.type,
          text: block.text.slice(0, 220),
        })),
      })),
    };
  }

  async streamChatCompletion(
    prepared: PreparedAiQuestion,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ) {
    await this.callChatCompletionStream(
      prepared.settings,
      prepared.question,
      prepared.contextText,
      prepared.conversationHistory,
      onDelta,
      signal,
    );
  }

  finalizeGeneratedAnswer(answer: string, sources: AiSourceSummary[]) {
    const citedIndexes = new Set<number>();
    const citationPattern =
      /[\[【]\s*资料\s*(\d+(?:\s*[,，、;；]\s*(?:资料\s*)?\d+)*)\s*[\]】]/gu;
    for (const match of answer.matchAll(citationPattern)) {
      for (const number of match[1]?.match(/\d+/gu) ?? []) {
        const index = Number(number) - 1;
        if (Number.isInteger(index) && index >= 0 && index < sources.length) {
          citedIndexes.add(index);
        }
      }
    }

    return {
      answer: answer
        .replace(citationPattern, "")
        .replace(/[ \t]+\n/g, "\n")
        .trim(),
      sources: sources.filter((_, index) => citedIndexes.has(index)),
    };
  }

  async createConversationTurn(
    userId: string | null,
    question: string,
    conversationId?: string,
    titleSettings?: AiCompletionSettings,
    signal?: AbortSignal,
  ): Promise<PreparedConversationTurn> {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const workspace = await this.getDefaultWorkspace();
    const generatedTitle = conversationId
      ? null
      : await this.generateConversationTitle(question, titleSettings, signal);
    const conversation = conversationId
      ? await this.getOwnedConversation(userId, conversationId)
      : await this.prisma.aiConversation.create({
          data: {
            workspaceId: workspace.id,
            userId,
            title: generatedTitle ?? buildFallbackConversationTitle(question),
          },
        });

    const userMessage = await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: question,
      },
    });

    const nextTitle =
      conversation.title === "新的对话"
        ? await this.generateConversationTitle(question, titleSettings, signal)
        : conversation.title;
    const updatedConversation = await this.prisma.aiConversation.update({
      where: { id: conversation.id },
      data: {
        title: nextTitle,
      },
    });

    return {
      conversation: updatedConversation,
      userMessage,
    };
  }

  async saveAssistantMessage(
    conversationId: string,
    content: string,
    sources: AiSourceSummary[],
  ) {
    const message = await this.prisma.aiMessage.create({
      data: {
        conversationId,
        role: "assistant",
        content,
        sourcesJson: sources as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.aiConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  private async buildContext(
    userId: string,
    question: string,
    options: { maxFiles: number; maxChars: number },
  ): Promise<ContextFile[]> {
    const candidates = await this.prisma.file.findMany({
      where: { status: { not: "archived" } },
      select: { id: true, status: true },
    });

    const permissionLevels = await this.permissions.getEffectiveLevelsForFiles(
      userId,
      candidates.map((file) => file.id),
    );
    const visibleIds = candidates
      .filter((file) => {
        const permission = permissionLevels.get(file.id) ?? null;
        return (
          canView(permission) &&
          !(file.status === "draft" && permission === "viewer")
        );
      })
      .map((file) => file.id);
    if (visibleIds.length === 0) return [];

    const files = await this.prisma.file.findMany({
      where: { id: { in: visibleIds } },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        updatedAt: true,
        blocks: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            type: true,
            dataJson: true,
            sortOrder: true,
          },
        },
      },
    });

    const searchableFiles = files
      .map((file) => ({
        ...file,
        blocks: file.blocks
          .map((block) => ({
            id: block.id,
            type: block.type,
            text: blockToText(block.type, block.dataJson),
            sortOrder: block.sortOrder,
          }))
          .filter((block) => Boolean(block.text)),
      }))
      .filter((file) => file.blocks.length > 0);
    const ranked = rankRetrievalFiles(searchableFiles, question);

    const selected: ContextFile[] = [];
    let charBudget = options.maxChars;
    const perFileBudget = Math.max(
      800,
      Math.floor((options.maxChars / Math.max(options.maxFiles, 1)) * 1.5),
    );

    for (const result of ranked) {
      if (selected.length >= options.maxFiles || charBudget <= 0) {
        break;
      }

      const blocks = [...result.blocks].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      );
      const clippedText = formatRetrievedBlocks(
        blocks,
        Math.min(charBudget, perFileBudget),
      );
      if (!clippedText) {
        continue;
      }
      selected.push({
        id: result.file.id,
        title: result.file.title,
        type: result.file.type,
        updatedAt: result.file.updatedAt,
        text: clippedText,
        score: result.score,
        blocks,
      });
      charBudget -= clippedText.length;
    }

    return selected;
  }

  private async callChatCompletion(
    settings: AiCompletionSettings,
    question: string,
    contextText: string,
    conversationHistory: AiConversationHistoryMessage[],
  ) {
    const endpoint = buildChatCompletionEndpoint(settings.baseUrl);
    const response = await this.fetchChatCompletion(
      endpoint,
      settings,
      question,
      contextText,
      conversationHistory,
      false,
    );

    const body = (await response.json().catch(() => null)) as {
      choices?: Array<{
        message?: { content?: string };
        text?: string;
      }>;
    } | null;
    const answer =
      body?.choices?.[0]?.message?.content?.trim() ??
      body?.choices?.[0]?.text?.trim();

    if (!answer) {
      throw new InternalServerErrorException("AI 服务没有返回有效回答");
    }

    return answer;
  }

  private async generateConversationTitle(
    question: string,
    settings?: AiCompletionSettings,
    signal?: AbortSignal,
  ) {
    const fallback = buildFallbackConversationTitle(question);

    if (!settings) {
      return fallback;
    }

    try {
      const title = await this.callConversationTitleCompletion(
        settings,
        question,
        signal,
      );
      return sanitizeAiConversationTitle(title) || fallback;
    } catch {
      return fallback;
    }
  }

  private async callConversationTitleCompletion(
    settings: AiCompletionSettings,
    question: string,
    signal?: AbortSignal,
  ) {
    const endpoint = buildChatCompletionEndpoint(settings.baseUrl);
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: AI_COMPLETION_TEMPERATURE,
          stream: false,
          messages: [
            {
              role: "system",
              content: [
                "你是对话标题生成器。",
                "根据用户第一条消息生成一个简短中文标题。",
                "只输出标题，不要解释，不要加引号，不要使用句号。",
                "标题应概括意图和主题，长度控制在 4 到 12 个汉字附近。",
              ].join("\n"),
            },
            {
              role: "user",
              content: question,
            },
          ],
          ...getProviderSpecificBody(settings.baseUrl, settings.model),
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ServiceUnavailableException("无法连接 AI 服务");
    }

    if (!response.ok) {
      throw new ServiceUnavailableException("AI 标题生成失败");
    }

    const body = (await response.json().catch(() => null)) as {
      choices?: Array<{
        message?: { content?: string };
        text?: string;
      }>;
    } | null;
    const title =
      body?.choices?.[0]?.message?.content?.trim() ??
      body?.choices?.[0]?.text?.trim();

    if (!title) {
      throw new InternalServerErrorException("AI 标题生成没有返回有效内容");
    }

    return title;
  }

  private async callChatCompletionStream(
    settings: AiCompletionSettings,
    question: string,
    contextText: string,
    conversationHistory: AiConversationHistoryMessage[],
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ) {
    const endpoint = buildChatCompletionEndpoint(settings.baseUrl);
    const response = await this.fetchChatCompletion(
      endpoint,
      settings,
      question,
      contextText,
      conversationHistory,
      true,
      signal,
    );

    if (!response.body) {
      throw new ServiceUnavailableException("AI 服务未返回流式内容");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) {
          continue;
        }

        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          return;
        }

        const parsed = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string };
            message?: { content?: string };
            text?: string;
          }>;
        };
        const delta =
          parsed.choices?.[0]?.delta?.content ??
          parsed.choices?.[0]?.message?.content ??
          parsed.choices?.[0]?.text ??
          "";

        if (delta) {
          onDelta(delta);
        }
      }
    }
  }

  private async fetchChatCompletion(
    endpoint: string,
    settings: AiCompletionSettings,
    question: string,
    contextText: string,
    conversationHistory: AiConversationHistoryMessage[],
    stream: boolean,
    signal?: AbortSignal,
  ) {
    const systemPrompt = [
      "你是 LiveBoard 的教学资料助手。",
      "用户只是寒暄或进行无需资料的普通对话时，直接自然回答，不要牵强引用资料。",
      "需要资料时，回答必须基于用户有权限访问的资料上下文；资料不足时要明确说明不足，并给出可验证的下一步建议。",
      "每当使用某份资料中的信息时，在相关陈述后标注对应编号，例如 [资料1]；只标注实际使用的资料，不要添加单独的参考文献列表。",
      "不要编造文件中没有的信息。回答使用简洁、专业的中文。",
    ].join("\n");

    const userPrompt = [
      "资料上下文：",
      contextText || "当前没有检索到可用资料。",
      "",
      "用户问题：",
      question,
    ].join("\n");

    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: settings.temperature,
          stream,
          messages: [
            { role: "system", content: systemPrompt },
            ...conversationHistory,
            { role: "user", content: userPrompt },
          ],
          ...getProviderSpecificBody(settings.baseUrl, settings.model),
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000),
      });
    } catch {
      throw new ServiceUnavailableException("无法连接 AI 服务");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ServiceUnavailableException(
        `AI 服务返回错误：${response.status}${body ? ` ${body.slice(0, 160)}` : ""}`,
      );
    }

    return response;
  }

  private async getOrCreateSettings() {
    const workspace = await this.getDefaultWorkspace();

    const settings = await this.prisma.aiSettings.upsert({
      where: { workspaceId: workspace.id },
      update: {},
      create: { workspaceId: workspace.id },
      include: { activeConfig: true },
    });
    if (settings.activeConfig) {
      settings.activeConfig = await this.decryptAndMigrateConfig(
        settings.activeConfig,
      );
    }
    return { ...settings, workspaceTimeZone: workspace.timeZone };
  }

  private async listStoredConfigs(workspaceId: string) {
    const configs = await this.prisma.aiProviderConfig.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    });
    return Promise.all(
      configs.map((config) => this.decryptAndMigrateConfig(config)),
    );
  }

  private async getWorkspaceConfig(configId: string) {
    const workspace = await this.getDefaultWorkspace();
    const config = await this.prisma.aiProviderConfig.findFirst({
      where: { id: configId, workspaceId: workspace.id },
    });

    if (!config) {
      throw new BadRequestException("AI 配置不存在");
    }

    return this.decryptAndMigrateConfig(config);
  }

  private async decryptAndMigrateConfig<
    T extends { id: string; apiKey: string },
  >(config: T): Promise<T> {
    const plaintext = this.secrets.decrypt(config.apiKey);
    if (!this.secrets.isEncrypted(config.apiKey) && plaintext) {
      await this.prisma.aiProviderConfig.update({
        where: { id: config.id },
        data: { apiKey: this.secrets.encrypt(plaintext) },
      });
    }
    return { ...config, apiKey: plaintext };
  }

  private async ensureUniqueConfigName(
    workspaceId: string,
    name: string,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.aiProviderConfig.findFirst({
      where: {
        workspaceId,
        name,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new BadRequestException("配置名称已存在");
    }
  }

  private async ensureAdmin(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !isSuperAdmin(user.systemRole) || user.status !== "active") {
      throw new ForbiddenException(
        "Only super administrators can manage AI settings",
      );
    }
  }

  private toPublicSettings(
    settings: {
      enabled: boolean;
      activeConfigId: string | null;
      activeConfig: {
        id: string;
        name: string;
        providerName: string;
        baseUrl: string;
        model: string;
        apiKey: string;
        createdAt: Date;
        updatedAt: Date;
      } | null;
      maxContextFiles: number;
      maxContextChars: number;
      defaultCallLimit: number;
      updatedAt: Date;
    },
    configs: Array<{
      id: string;
      name: string;
      providerName: string;
      baseUrl: string;
      model: string;
      apiKey: string;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ) {
    return {
      enabled: settings.enabled,
      activeConfigId: settings.activeConfigId,
      activeConfig: settings.activeConfig
        ? this.toPublicProviderConfig(settings.activeConfig)
        : null,
      configs: configs.map((config) => this.toPublicProviderConfig(config)),
      maxContextFiles: settings.maxContextFiles,
      maxContextChars: settings.maxContextChars,
      defaultCallLimit: settings.defaultCallLimit,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  private toPublicProviderConfig(config: {
    id: string;
    name: string;
    providerName: string;
    baseUrl: string;
    model: string;
    apiKey: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: config.id,
      name: config.name,
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyConfigured: Boolean(config.apiKey),
      apiKeyPreview: maskApiKey(config.apiKey),
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!workspace) {
      throw new BadRequestException("Workspace not found. Run seed first.");
    }

    return workspace;
  }

  private async getOwnedConversation(userId: string, conversationId: string) {
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation || conversation.userId !== userId) {
      throw new ForbiddenException("No permission to use AI conversation");
    }

    return conversation;
  }

  private async getRecentConversationHistory(
    userId: string,
    conversationId: string,
  ): Promise<AiConversationHistoryMessage[]> {
    await this.getOwnedConversation(userId, conversationId);
    const messages = await this.prisma.aiMessage.findMany({
      where: {
        conversationId,
        role: { in: ["user", "assistant"] },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { role: true, content: true },
    });

    return messages
      .reverse()
      .map((message): AiConversationHistoryMessage => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content.slice(0, 4000),
      }))
      .filter((message) => Boolean(message.content.trim()));
  }

  private toConversationSummary(conversation: {
    id: string;
    title: string;
    pinnedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: conversation.id,
      title: conversation.title,
      pinned: Boolean(conversation.pinnedAt),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private toMessageSummary(message: {
    id: string;
    role: string;
    content: string;
    sourcesJson?: unknown;
    createdAt: Date;
  }) {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      sources: parseSources(message.sourcesJson),
      createdAt: message.createdAt.toISOString(),
    };
  }
}

function normalizeConfigName(value: string) {
  return requireResourceName(value, "配置名称");
}

function normalizeProviderName(value: string) {
  const providerName = value.trim();
  if (!providerName) {
    throw new BadRequestException("请选择 AI 服务商");
  }
  return providerName;
}

function normalizeModel(value: string) {
  const model = value.trim();
  if (!model) {
    throw new BadRequestException("请输入模型 ID");
  }
  return model;
}

function normalizeApiKey(value: string, required: boolean) {
  const apiKey = value.trim();
  if (required && !apiKey) {
    throw new BadRequestException("请输入 API Key");
  }
  return apiKey;
}

function ensureCompleteConfig(config: {
  baseUrl: string;
  model: string;
  apiKey: string;
}) {
  if (!config.baseUrl || !config.model || !config.apiKey) {
    throw new BadRequestException("AI 配置不完整，请先补全并保存");
  }
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new BadRequestException("请输入 AI 服务地址");
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException("AI 服务地址格式无效");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new BadRequestException("AI 服务地址只支持 HTTP 或 HTTPS");
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestException("AI 服务地址不能包含账号或密码");
  }

  return parsed.toString().replace(/\/+$/, "");
}

function buildChatCompletionEndpoint(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);

  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }

  return `${normalized}/chat/completions`;
}

function getProviderSpecificBody(baseUrl: string, model: string) {
  const isDeepSeek =
    baseUrl.toLowerCase().includes("deepseek") ||
    model.toLowerCase().startsWith("deepseek-");

  if (!isDeepSeek) {
    return {};
  }

  if (model === "deepseek-v4-pro") {
    return {
      thinking: { type: "enabled" },
      reasoning_effort: "medium",
    };
  }

  return {};
}

function maskApiKey(value: string) {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isConversationalPrompt(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s，。.!！?？～~]+/g, "");

  return /^(你好|您好|嗨|哈喽|hello|hi|早上好|上午好|下午好|晚上好|晚安|谢谢|感谢|不客气|再见|拜拜|在吗|你是谁|你能做什么|有什么功能)(呀|啊|呢|哦|啦|吗)?$/.test(
    normalized,
  );
}

function buildRetrievalQuery(
  question: string,
  history: AiConversationHistoryMessage[],
) {
  const recentUserMessages = history
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.content.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return [...recentUserMessages, question].join("\n").slice(-1600);
}

function formatRetrievedBlocks(blocks: ContextBlock[], maxChars: number) {
  const parts: string[] = [];
  let remaining = maxChars;

  for (const [index, block] of blocks.entries()) {
    if (remaining <= 0) {
      break;
    }
    const label = `[相关片段 ${index + 1} · ${contextBlockLabel(block.type)}]\n`;
    if (remaining <= label.length) {
      break;
    }
    const text = block.text.slice(0, remaining - label.length);
    parts.push(`${label}${text}`);
    remaining -= label.length + text.length + 2;
  }

  return parts.join("\n\n").trim();
}

function contextBlockLabel(type: string) {
  if (/^heading_[1-6]$/u.test(type)) return "标题";
  if (type === "code") return "代码";
  if (type === "question") return "题目";
  if (type === "table") return "表格";
  if (type === "quote") return "引用";
  return "正文";
}

function buildFallbackConversationTitle(question: string) {
  const normalized = question.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "新的对话";
  }

  return normalized.length > 18 ? normalized.slice(0, 18) : normalized;
}

function sanitizeAiConversationTitle(title: string) {
  const firstLine = title.split("\n")[0] ?? "";
  const normalized = firstLine
    .replace(/^标题[:：]\s*/u, "")
    .replace(/[“”"'`]/g, "")
    .replace(/[。！？?!.；;，,、\s]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const maxLength = 18;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function parseSources(value: unknown): AiSourceSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const source = item as {
        id?: unknown;
        title?: unknown;
        type?: unknown;
        updatedAt?: unknown;
        blocks?: unknown;
      };

      if (typeof source.id !== "string" || typeof source.title !== "string") {
        return null;
      }

      return {
        id: source.id,
        title: source.title,
        type: typeof source.type === "string" ? source.type : "",
        updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
        blocks: Array.isArray(source.blocks)
          ? source.blocks
              .map((block) => {
                if (!block || typeof block !== "object") {
                  return null;
                }

                const sourceBlock = block as {
                  id?: unknown;
                  type?: unknown;
                  text?: unknown;
                };

                if (
                  typeof sourceBlock.id !== "string" ||
                  typeof sourceBlock.text !== "string"
                ) {
                  return null;
                }

                return {
                  id: sourceBlock.id,
                  type:
                    typeof sourceBlock.type === "string"
                      ? sourceBlock.type
                      : "",
                  text: sourceBlock.text,
                };
              })
              .filter((block): block is NonNullable<typeof block> =>
                Boolean(block),
              )
          : [],
      };
    })
    .filter((source): source is AiSourceSummary => Boolean(source));
}

function blockToText(type: string, dataJson: unknown) {
  if (
    type === "table" &&
    dataJson &&
    typeof dataJson === "object" &&
    "rows" in dataJson &&
    Array.isArray(dataJson.rows)
  ) {
    return dataJson.rows
      .filter(Array.isArray)
      .map((row) => row.map((cell) => String(cell ?? "")).join(" | "))
      .join("\n");
  }

  const text = getText(dataJson);

  if (!text) {
    return "";
  }

  if (/^heading_[1-6]$/u.test(type)) {
    return `# ${text}`;
  }

  if (type === "code") {
    return `代码：\n${text}`;
  }

  if (type === "question") {
    return `题目：${text}`;
  }

  return text;
}

function getText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  if ("text" in value && typeof value.text === "string") {
    return value.text;
  }

  if ("filename" in value && typeof value.filename === "string") {
    return value.filename;
  }

  if ("url" in value && typeof value.url === "string") {
    return value.url;
  }

  return "";
}
