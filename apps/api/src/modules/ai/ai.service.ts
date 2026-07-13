import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { canView, isSuperAdmin } from "@liveboard/shared";
import type { Prisma } from "@prisma/client";
import { PermissionsService } from "../permissions/permissions.service";
import { PrismaService } from "../prisma/prisma.service";

interface UpdateAiSettingsInput {
  enabled?: boolean;
  providerName?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  temperature?: number;
  maxContextFiles?: number;
  maxContextChars?: number;
}

interface AskAiInput {
  message: string;
  conversationId?: string;
}

interface AiSourceSummary {
  id: string;
  title: string;
  type: string;
  updatedAt: string;
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
}

interface PreparedAiQuestion {
  settings: AiCompletionSettings;
  question: string;
  contextText: string;
  sources: AiSourceSummary[];
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
  ) {}

  async getSettings(userId: string | null) {
    await this.ensureAdmin(userId);
    const settings = await this.getOrCreateSettings();
    return this.toPublicSettings(settings);
  }

  async getAvailability(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const settings = await this.getOrCreateSettings();
    const configured = Boolean(
      settings.baseUrl && settings.model && settings.apiKey,
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

  async updateSettings(userId: string | null, input: UpdateAiSettingsInput) {
    await this.ensureAdmin(userId);

    const settings = await this.getOrCreateSettings();
    const data: Prisma.AiSettingsUpdateInput = {};

    if (input.enabled !== undefined) {
      data.enabled = input.enabled;
    }

    if (input.providerName !== undefined) {
      data.providerName = input.providerName.trim() || "OpenAI Compatible";
    }

    if (input.baseUrl !== undefined) {
      data.baseUrl = normalizeBaseUrl(input.baseUrl);
    }

    if (input.model !== undefined) {
      data.model = input.model.trim();
    }

    if (input.apiKey !== undefined) {
      const nextKey = input.apiKey.trim();
      if (nextKey && nextKey !== "********") {
        data.apiKey = nextKey;
      }
    }

    if (input.temperature !== undefined) {
      data.temperature = input.temperature;
    }

    if (input.maxContextFiles !== undefined) {
      data.maxContextFiles = input.maxContextFiles;
    }

    if (input.maxContextChars !== undefined) {
      data.maxContextChars = input.maxContextChars;
    }

    data.updatedById = userId;

    const updated = await this.prisma.aiSettings.update({
      where: { id: settings.id },
      data,
    });

    return this.toPublicSettings(updated);
  }

  async listConversations(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const conversations = await this.prisma.aiConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
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

    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sources: parseSources(message.sourcesJson),
        createdAt: message.createdAt.toISOString(),
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

  async ask(userId: string | null, input: AskAiInput) {
    const prepared = await this.prepareQuestion(userId, input.message);
    const turn = await this.createConversationTurn(
      userId,
      prepared.question,
      input.conversationId,
      prepared.settings,
    );
    const answer = await this.callChatCompletion(
      prepared.settings,
      prepared.question,
      prepared.contextText,
    );
    const assistantMessage = await this.saveAssistantMessage(
      turn.conversation.id,
      answer,
      prepared.sources,
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
      sources: prepared.sources,
    };
  }

  async prepareQuestion(
    userId: string | null,
    message: string,
  ): Promise<PreparedAiQuestion> {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const question = message.trim();
    if (!question) {
      throw new BadRequestException("请输入问题");
    }

    const settings = await this.getOrCreateSettings();

    if (!settings.enabled) {
      throw new ServiceUnavailableException("AI 助手尚未启用");
    }

    if (!settings.baseUrl || !settings.model || !settings.apiKey) {
      throw new ServiceUnavailableException("AI 配置不完整，请联系管理员");
    }

    const contextFiles = await this.buildContext(userId, question, {
      maxFiles: settings.maxContextFiles,
      maxChars: settings.maxContextChars,
    });
    const contextText = contextFiles
      .map((file, index) =>
        [
          `资料 ${index + 1}: ${file.title}`,
          `类型: ${file.type}`,
          `更新时间: ${file.updatedAt.toISOString()}`,
          file.text,
        ].join("\n"),
      )
      .join("\n\n---\n\n");

    return {
      settings: {
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        temperature: settings.temperature,
      },
      question,
      contextText,
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
  ) {
    await this.callChatCompletionStream(
      prepared.settings,
      prepared.question,
      prepared.contextText,
      onDelta,
    );
  }

  async createConversationTurn(
    userId: string | null,
    question: string,
    conversationId?: string,
    titleSettings?: AiCompletionSettings,
  ): Promise<PreparedConversationTurn> {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const workspace = await this.getDefaultWorkspace();
    const generatedTitle = conversationId
      ? null
      : await this.generateConversationTitle(question, titleSettings);
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
        ? await this.generateConversationTitle(question, titleSettings)
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
    const files = await this.prisma.file.findMany({
      where: { status: { not: "archived" } },
      include: {
        blocks: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 80,
    });

    const keywords = tokenize(question);
    const visible: ContextFile[] = [];

    for (const file of files) {
      const permission = await this.permissions.getEffectiveLevelForFile(
        userId,
        file.id,
      );

      if (!canView(permission)) {
        continue;
      }

      if (file.status === "draft" && permission === "viewer") {
        continue;
      }

      const blocks = file.blocks
        .map((block) => ({
          id: block.id,
          type: block.type,
          text: blockToText(block.type, block.dataJson),
        }))
        .filter((block) => Boolean(block.text));
      const text = blocks
        .map((block) => block.text)
        .filter(Boolean)
        .join("\n");

      if (!text.trim()) {
        continue;
      }

      const searchable = `${file.title}\n${text}`.toLowerCase();
      const score =
        keywords.reduce(
          (total, keyword) => total + countOccurrences(searchable, keyword),
          0,
        ) + (file.status === "published" ? 0.25 : 0);

      visible.push({
        id: file.id,
        title: file.title,
        type: file.type,
        updatedAt: file.updatedAt,
        text,
        score,
        blocks: rankBlocks(blocks, keywords),
      });
    }

    const sorted = visible.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    const selected: ContextFile[] = [];
    let charBudget = options.maxChars;

    for (const file of sorted) {
      if (selected.length >= options.maxFiles || charBudget <= 0) {
        break;
      }

      const clippedText = file.text.slice(0, charBudget);
      selected.push({ ...file, text: clippedText });
      charBudget -= clippedText.length;
    }

    return selected;
  }

  private async callChatCompletion(
    settings: AiCompletionSettings,
    question: string,
    contextText: string,
  ) {
    const endpoint = buildChatCompletionEndpoint(settings.baseUrl);
    const response = await this.fetchChatCompletion(
      endpoint,
      settings,
      question,
      contextText,
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
  ) {
    const fallback = buildFallbackConversationTitle(question);

    if (!settings) {
      return fallback;
    }

    try {
      const title = await this.callConversationTitleCompletion(
        settings,
        question,
      );
      return sanitizeAiConversationTitle(title) || fallback;
    } catch {
      return fallback;
    }
  }

  private async callConversationTitleCompletion(
    settings: AiCompletionSettings,
    question: string,
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
          temperature: 0.2,
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
        signal: AbortSignal.timeout(30_000),
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
    onDelta: (delta: string) => void,
  ) {
    const endpoint = buildChatCompletionEndpoint(settings.baseUrl);
    const response = await this.fetchChatCompletion(
      endpoint,
      settings,
      question,
      contextText,
      true,
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
    stream: boolean,
  ) {
    const systemPrompt = [
      "你是 LiveBoard 的教学资料助手。",
      "回答必须基于用户有权限访问的资料上下文，资料不足时要明确说明不足，并给出可验证的下一步建议。",
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
            { role: "user", content: userPrompt },
          ],
          ...getProviderSpecificBody(settings.baseUrl, settings.model),
        }),
        signal: AbortSignal.timeout(120_000),
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

    return this.prisma.aiSettings.upsert({
      where: { workspaceId: workspace.id },
      update: {},
      create: { workspaceId: workspace.id },
    });
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

  private toPublicSettings(settings: {
    enabled: boolean;
    providerName: string;
    baseUrl: string;
    model: string;
    apiKey: string;
    temperature: number;
    maxContextFiles: number;
    maxContextChars: number;
    updatedAt: Date;
  }) {
    return {
      enabled: settings.enabled,
      providerName: settings.providerName,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKeyConfigured: Boolean(settings.apiKey),
      apiKeyPreview: maskApiKey(settings.apiKey),
      temperature: settings.temperature,
      maxContextFiles: settings.maxContextFiles,
      maxContextChars: settings.maxContextChars,
      updatedAt: settings.updatedAt.toISOString(),
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

  private toConversationSummary(conversation: {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: conversation.id,
      title: conversation.title,
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

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
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

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[\s,，。.!！?？;；:：()[\]{}"'“”‘’<>《》、/\\|-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 16);
}

function countOccurrences(value: string, keyword: string) {
  if (!keyword) {
    return 0;
  }

  let count = 0;
  let index = value.indexOf(keyword);

  while (index !== -1) {
    count += 1;
    index = value.indexOf(keyword, index + keyword.length);
  }

  return count;
}

function rankBlocks(blocks: ContextBlock[], keywords: string[]) {
  return [...blocks].sort((a, b) => {
    const scoreA = keywords.reduce(
      (total, keyword) =>
        total + countOccurrences(a.text.toLowerCase(), keyword),
      0,
    );
    const scoreB = keywords.reduce(
      (total, keyword) =>
        total + countOccurrences(b.text.toLowerCase(), keyword),
      0,
    );

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    return 0;
  });
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
  const text = getText(dataJson);

  if (!text) {
    return "";
  }

  if (type === "heading") {
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
