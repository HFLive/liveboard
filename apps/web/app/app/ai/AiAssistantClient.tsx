"use client";

import Link from "next/link";
import {
  FormEvent,
  Fragment,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Bot,
  Check,
  Copy,
  History,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Square,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  askAiStream,
  deleteAiConversation,
  getAiConversation,
  getAiStatus,
  listAiConversations,
  type AiConversationSummary,
  type AiMessageSummary,
  type AiSourceSummary,
  type AiStatus,
} from "@/lib/api";
import { formatDateTime } from "@/lib/labels";
import { contentDetail } from "@/lib/routes";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AiSourceSummary[];
};

const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "你可以问我关于图书馆中资料的问题。我会优先基于你有权限访问的文件回答，并在回答后列出参考来源。",
};

const promptSuggestions = [
  "总结最近更新的资料",
  "梳理本周课程重点",
  "根据资料生成练习题",
  "找出可复用的教学模板",
];

export function AiAssistantClient() {
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [conversations, setConversations] = useState<AiConversationSummary[]>(
    [],
  );
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [loadingConversationId, setLoadingConversationId] = useState<
    string | null
  >(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [openHistoryMenu, setOpenHistoryMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [question, setQuestion] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([getAiStatus(), listAiConversations()])
      .then(async ([aiResult, conversationsResult]) => {
        if (!active) {
          return;
        }

        setAiStatus(aiResult.status);
        setConversations(conversationsResult.conversations);

        const latest = conversationsResult.conversations[0];
        if (latest) {
          const detail = await getAiConversation(latest.id);
          if (active) {
            setActiveConversationId(detail.conversation.id);
            setMessages(toChatMessages(detail.conversation.messages));
          }
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "加载失败");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const messagesContainer = messagesContainerRef.current;
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }, [messages, asking]);

  useEffect(() => {
    const textarea = questionInputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [question]);

  useEffect(() => {
    function closeHistoryMenu(event: MouseEvent) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("[data-menu-root='true']")
      ) {
        return;
      }

      setOpenHistoryMenu(null);
    }

    document.addEventListener("mousedown", closeHistoryMenu);
    return () => document.removeEventListener("mousedown", closeHistoryMenu);
  }, []);

  const aiUnavailableReason =
    aiStatus && !aiStatus.available ? aiStatus.reason : null;
  const activeConversation =
    conversations.find(
      (conversation) => conversation.id === activeConversationId,
    ) ?? null;
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase();
  const filteredConversations = normalizedHistoryQuery
    ? conversations.filter((conversation) =>
        `${conversation.title} ${conversation.lastMessagePreview ?? ""}`
          .toLowerCase()
          .includes(normalizedHistoryQuery),
      )
    : conversations;
  const historyGroups = groupConversationsByRecency(filteredConversations);
  const hasOnlyWelcome =
    messages.length === 1 && messages[0]?.id === welcomeMessage.id;

  async function onAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = question.trim();
    if (!trimmed || asking || !aiStatus?.available) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    const assistantMessageId = `assistant-${Date.now()}`;

    setMessages((current) => {
      const nextMessages: ChatMessage[] = [
        userMessage,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
        },
      ];

      return current.length === 1 && current[0]?.id === welcomeMessage.id
        ? nextMessages
        : [...current, ...nextMessages];
    });
    setQuestion("");
    setAiError(null);
    setAsking(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let streamConversationId = activeConversationId;

    try {
      await askAiStream(
        {
          message: trimmed,
          ...(activeConversationId
            ? { conversationId: activeConversationId }
            : {}),
        },
        {
          onConversation: ({ conversation }) => {
            streamConversationId = conversation.id;
            setActiveConversationId(conversation.id);
            setConversations((current) =>
              upsertConversation(current, {
                ...conversation,
                lastMessagePreview: trimmed.slice(0, 80),
              }),
            );
          },
          onSources: (sources) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, sources }
                  : message,
              ),
            );
          },
          onDelta: (delta) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: message.content + delta }
                  : message,
              ),
            );
          },
          onMessage: (message) => {
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantMessageId
                  ? {
                      id: message.id,
                      role: "assistant",
                      content: message.content,
                      sources: message.sources,
                    }
                  : item,
              ),
            );
            setConversations((current) =>
              current.map((conversation) =>
                conversation.id === streamConversationId
                  ? {
                      ...conversation,
                      updatedAt: message.createdAt,
                      lastMessagePreview: message.content.slice(0, 80),
                    }
                  : conversation,
              ),
            );
          },
        },
        abortController.signal,
      );
    } catch (caught) {
      if (abortController.signal.aborted) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId && message.content
              ? { ...message, content: `${message.content}\n\n（已停止生成）` }
              : message,
          ),
        );
      } else {
        setAiError(caught instanceof Error ? caught.message : "AI 请求失败");
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setAsking(false);
    }
  }

  function onStopAsking() {
    abortControllerRef.current?.abort();
  }

  function toggleHistoryMenu(
    conversationId: string,
    button: HTMLButtonElement,
  ) {
    setOpenHistoryMenu((current) => {
      if (current?.id === conversationId) {
        return null;
      }

      return {
        id: conversationId,
        ...getHistoryMenuPosition(button),
      };
    });
  }

  function onNewConversation() {
    if (asking) {
      return;
    }

    setOpenHistoryMenu(null);
    setActiveConversationId(null);
    setMessages([welcomeMessage]);
    setAiError(null);
    setMobileHistoryOpen(false);
  }

  function onUseSuggestion(suggestion: string) {
    setQuestion(suggestion);
    window.requestAnimationFrame(() => {
      questionInputRef.current?.focus();
    });
  }

  async function onCopyMessage(message: ChatMessage) {
    if (!message.content.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        setCopiedMessageId((current) =>
          current === message.id ? null : current,
        );
      }, 1400);
    } catch {
      setAiError("复制失败，请手动选择文本复制");
    }
  }

  async function onSelectConversation(conversationId: string) {
    if (asking || conversationId === activeConversationId) {
      return;
    }

    setOpenHistoryMenu(null);
    setMobileHistoryOpen(false);
    setLoadingConversationId(conversationId);
    setAiError(null);

    try {
      const result = await getAiConversation(conversationId);
      setActiveConversationId(result.conversation.id);
      setMessages(toChatMessages(result.conversation.messages));
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : "加载历史对话失败");
    } finally {
      setLoadingConversationId(null);
    }
  }

  async function onDeleteConversation(conversationId: string) {
    if (asking) {
      return;
    }

    setOpenHistoryMenu(null);

    try {
      await deleteAiConversation(conversationId);
      setConversations((current) =>
        current.filter((conversation) => conversation.id !== conversationId),
      );

      if (conversationId === activeConversationId) {
        setActiveConversationId(null);
        setMessages([welcomeMessage]);
      }
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : "删除历史对话失败");
    }
  }

  return (
    <div className="workspace ai-workspace">
      {error ? <p className="error-text">{error}</p> : null}

      <section className="ai-workbench" aria-label="AI 助手">
        <button
          aria-label="关闭历史记录"
          className={
            mobileHistoryOpen ? "ai-mobile-backdrop open" : "ai-mobile-backdrop"
          }
          onClick={() => setMobileHistoryOpen(false)}
          type="button"
        />
        <aside
          className={
            mobileHistoryOpen ? "ai-sidebar mobile-open" : "ai-sidebar"
          }
          aria-label="AI 历史记录"
        >
          <div className="ai-brand-panel">
            <div
              aria-label={
                aiStatus
                  ? aiStatus.available
                    ? "AI 服务可用"
                    : "AI 服务暂不可用"
                  : "AI 服务连接中"
              }
              className="ai-service-status"
              title={
                aiStatus
                  ? aiStatus.available
                    ? "服务可用"
                    : "暂不可用"
                  : "连接中"
              }
            >
              <Bot aria-hidden="true" />
              <span
                className={
                  aiStatus
                    ? aiStatus.available
                      ? "ai-title-status ok"
                      : "ai-title-status unavailable"
                    : "ai-title-status"
                }
              />
            </div>
          </div>

          <div className="ai-sidebar-head">
            <div>
              <h2>历史对话</h2>
              <span>{filteredConversations.length} 条</span>
            </div>
            <button
              className={
                activeConversationId
                  ? "history-new-button"
                  : "history-new-button active"
              }
              disabled={asking}
              onClick={onNewConversation}
              type="button"
            >
              <Plus aria-hidden="true" />
              新对话
            </button>
          </div>
          <label className="ai-history-search">
            <Search aria-hidden="true" />
            <input
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="搜索历史"
              value={historyQuery}
            />
          </label>
          <div className="history-list">
            {historyGroups.map((group) => (
              <section className="history-group" key={group.label}>
                <h3>{group.label}</h3>
                {group.items.map((conversation) => (
                  <div
                    className={
                      conversation.id === activeConversationId
                        ? "history-item active"
                        : "history-item"
                    }
                    data-menu-root="true"
                    key={conversation.id}
                  >
                    <button
                      className="history-main-button"
                      disabled={
                        asking || loadingConversationId === conversation.id
                      }
                      onClick={() => void onSelectConversation(conversation.id)}
                      type="button"
                    >
                      <span className="history-title-row">
                        <strong>{conversation.title}</strong>
                        <time>{formatDateTime(conversation.updatedAt)}</time>
                      </span>
                      <small>
                        {loadingConversationId === conversation.id
                          ? "加载中"
                          : conversation.lastMessagePreview || "暂无消息"}
                      </small>
                    </button>
                    <button
                      aria-expanded={openHistoryMenu?.id === conversation.id}
                      className="history-more-button"
                      disabled={asking}
                      onClick={(event) =>
                        toggleHistoryMenu(conversation.id, event.currentTarget)
                      }
                      title="对话操作"
                      type="button"
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </button>
                    {openHistoryMenu?.id === conversation.id ? (
                      <div
                        className="context-menu floating-context-menu history-context-menu"
                        data-menu-root="true"
                        style={{
                          left: openHistoryMenu.x,
                          top: openHistoryMenu.y,
                        }}
                      >
                        <button
                          className="danger"
                          onClick={() =>
                            void onDeleteConversation(conversation.id)
                          }
                          type="button"
                        >
                          <Trash2 aria-hidden="true" />
                          删除
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </section>
            ))}
            {filteredConversations.length === 0 ? (
              <span className="history-empty">
                {historyQuery ? "没有匹配的历史" : "暂无历史"}
              </span>
            ) : null}
          </div>
        </aside>

        <section className="ai-chat-panel" aria-label="AI 对话">
          <header className="ai-chat-toolbar">
            <strong title={activeConversation?.title ?? "新对话"}>
              {activeConversation?.title ?? "新对话"}
            </strong>
            <div className="ai-chat-toolbar-actions">
              <button
                className="button secondary ai-history-toggle"
                onClick={() => setMobileHistoryOpen(true)}
                type="button"
              >
                <History aria-hidden="true" className="button-icon" />
                历史
              </button>
              <button
                className="button secondary"
                disabled={asking || !activeConversationId}
                onClick={onNewConversation}
                type="button"
              >
                <Plus aria-hidden="true" className="button-icon" />
                新对话
              </button>
            </div>
          </header>
          <div className="home-ai-messages" ref={messagesContainerRef}>
            {hasOnlyWelcome ? (
              <div className="ai-welcome">
                <span className="ai-welcome-mark" aria-hidden="true">
                  <Sparkles />
                </span>
                <div>
                  <h2>从资料中查找答案</h2>
                  <p>{welcomeMessage.content}</p>
                </div>
                <div className="ai-suggestion-list" aria-label="推荐提问">
                  {promptSuggestions.map((suggestion) => (
                    <button
                      disabled={asking || !aiStatus?.available}
                      key={suggestion}
                      onClick={() => onUseSuggestion(suggestion)}
                      type="button"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={
                    message.role === "user"
                      ? "chat-bubble user"
                      : "chat-bubble assistant"
                  }
                  data-role={message.role}
                  key={message.id}
                >
                  <div className="chat-message-head">
                    {message.role === "assistant" ? (
                      <div className="chat-role">
                        <span className="chat-role-mark" aria-hidden="true">
                          <Sparkles />
                        </span>
                        <span>LiveBoard</span>
                      </div>
                    ) : null}
                    {message.content.trim() ? (
                      <button
                        aria-label={`复制${
                          message.role === "user" ? "问题" : "回答"
                        }`}
                        className="chat-copy-button"
                        onClick={() => void onCopyMessage(message)}
                        title="复制消息"
                        type="button"
                      >
                        {copiedMessageId === message.id ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Copy aria-hidden="true" />
                        )}
                        <span>
                          {copiedMessageId === message.id ? "已复制" : "复制"}
                        </span>
                      </button>
                    ) : null}
                  </div>
                  <div className="chat-message-body">
                    <MarkdownContent
                      content={
                        message.content ||
                        (message.role === "assistant"
                          ? "正在检索资料并生成回答..."
                          : "")
                      }
                    />
                  </div>
                  {message.sources && message.sources.length > 0 ? (
                    <SourceList sources={message.sources} />
                  ) : null}
                </article>
              ))
            )}
          </div>

          {aiUnavailableReason ? (
            <p className="ai-inline-notice">{aiUnavailableReason}</p>
          ) : null}
          {aiError ? <p className="ai-inline-error">{aiError}</p> : null}

          <form className="home-ai-composer" onSubmit={onAsk}>
            <textarea
              ref={questionInputRef}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="询问资料中的专业问题..."
              rows={1}
              value={question}
            />
            <div className="composer-foot">
              <span className="composer-meta">
                {question.trim().length > 0
                  ? `${question.trim().length} 字`
                  : "Enter 发送 · Shift + Enter 换行"}
              </span>
              <div className="composer-actions">
                {asking ? (
                  <button
                    className="button secondary"
                    onClick={onStopAsking}
                    type="button"
                  >
                    <Square aria-hidden="true" className="button-icon" />
                    停止生成
                  </button>
                ) : null}
                <button
                  className="button"
                  disabled={asking || !question.trim() || !aiStatus?.available}
                  type="submit"
                >
                  <Send aria-hidden="true" className="button-icon" />
                  发送
                </button>
              </div>
            </div>
          </form>
        </section>
      </section>
    </div>
  );
}

function SourceList({ sources }: { sources: AiSourceSummary[] }) {
  return (
    <div className="chat-sources">
      <span>参考资料（{sources.length}）</span>
      {sources.map((source) => (
        <details className="chat-source-detail" key={source.id}>
          <summary>
            <Link href={contentDetail(source.id)}>{source.title}</Link>
          </summary>
          {source.blocks && source.blocks.length > 0 ? (
            <div className="source-block-list">
              {source.blocks.map((block) => (
                <Link href={contentDetail(source.id)} key={block.id}>
                  <small>{blockTypeLabel(block.type)}</small>
                  <span>{block.text}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p>本次回答参考了该文件。</p>
          )}
        </details>
      ))}
    </div>
  );
}

function toChatMessages(messages: AiMessageSummary[]): ChatMessage[] {
  if (messages.length === 0) {
    return [welcomeMessage];
  }

  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sources: message.sources,
    }));
}

function upsertConversation(
  conversations: AiConversationSummary[],
  nextConversation: AiConversationSummary,
) {
  return [
    nextConversation,
    ...conversations.filter(
      (conversation) => conversation.id !== nextConversation.id,
    ),
  ];
}

function getHistoryMenuPosition(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect();
  const menuWidth = 132;
  const menuHeight = 36;
  const x = Math.max(
    8,
    Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
  );
  const y =
    rect.bottom + 6 + menuHeight > window.innerHeight
      ? Math.max(8, rect.top - menuHeight - 6)
      : rect.bottom + 6;

  return { x, y };
}

function groupConversationsByRecency(conversations: AiConversationSummary[]) {
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const recentStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const todayGroup = { label: "今天", items: [] as AiConversationSummary[] };
  const recentGroup = {
    label: "近 7 天",
    items: [] as AiConversationSummary[],
  };
  const olderGroup = { label: "更早", items: [] as AiConversationSummary[] };

  for (const conversation of conversations) {
    const updatedTime = new Date(conversation.updatedAt).getTime();

    if (Number.isNaN(updatedTime)) {
      olderGroup.items.push(conversation);
    } else if (updatedTime >= todayStart) {
      todayGroup.items.push(conversation);
    } else if (updatedTime >= recentStart) {
      recentGroup.items.push(conversation);
    } else {
      olderGroup.items.push(conversation);
    }
  }

  return [todayGroup, recentGroup, olderGroup].filter(
    (group) => group.items.length > 0,
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-content">{renderMarkdownBlocks(content)}</div>
  );
}

function renderMarkdownBlocks(content: string) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push(
        <pre key={`code-${index}`}>
          {language ? <span>{language}</span> : null}
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const marker = headingMatch[1] ?? "";
      const headingText = headingMatch[2] ?? "";
      const level = marker.length;
      const Heading = `h${Math.min(level + 2, 5)}` as "h3" | "h4" | "h5";
      blocks.push(
        <Heading key={`heading-${index}`}>
          {renderInlineMarkdown(headingText)}
        </Heading>,
      );
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines = [line];
    index += 1;

    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !(lines[index] ?? "").startsWith("```") &&
      !/^(#{1,3})\s+/.test(lines[index] ?? "") &&
      !/^\s*[-*]\s+/.test(lines[index] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[index] ?? "")
    ) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }

    blocks.push(
      <p key={`p-${index}`}>
        {renderInlineMarkdown(paragraphLines.join("\n"))}
      </p>,
    );
  }

  return blocks;
}

function renderInlineMarkdown(text: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        renderLineBreaks(text.slice(lastIndex, match.index), nodes.length),
      );
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={`code-${nodes.length}`}>{token.slice(1, -1)}</code>,
      );
    } else {
      nodes.push(
        <strong key={`strong-${nodes.length}`}>{token.slice(2, -2)}</strong>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(renderLineBreaks(text.slice(lastIndex), nodes.length));
  }

  return nodes;
}

function renderLineBreaks(text: string, keyPrefix: number) {
  const parts = text.split("\n");

  return parts.map((part, index) => (
    <Fragment key={`${keyPrefix}-${index}`}>
      {index > 0 ? <br /> : null}
      {part}
    </Fragment>
  ));
}

function blockTypeLabel(type: string) {
  const labels: Record<string, string> = {
    heading: "标题",
    heading_1: "一级标题",
    heading_2: "二级标题",
    heading_3: "三级标题",
    paragraph: "段落",
    list: "列表",
    bullet_list: "列表",
    ordered_list: "有序列表",
    code: "代码",
    image: "图片",
    attachment: "附件",
    reference: "引用",
    question: "题目",
  };

  return labels[type] ?? type;
}
