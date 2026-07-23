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
  Check,
  Copy,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCcw,
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
  updateAiConversation,
  type AiConversationSummary,
  type AiMessageSummary,
  type AiSourceSummary,
  type AiStatus,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/labels";
import { contentDetail } from "@/lib/routes";
import { AutoTextarea } from "@/components/AutoTextarea";

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
  "总结最近更新文档的核心内容",
  "把课程资料整理成一份授课提纲",
  "根据资料生成 5 道复习题并附答案",
  "找出资料中需要补充或进一步核对的内容",
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

  async function onRenameConversation(conversation: AiConversationSummary) {
    if (asking) return;

    const title = window.prompt("重命名对话", conversation.title)?.trim();
    setOpenHistoryMenu(null);
    if (!title || title === conversation.title) return;

    try {
      const result = await updateAiConversation(conversation.id, { title });
      setConversations((current) =>
        sortConversations(
          current.map((item) =>
            item.id === conversation.id
              ? { ...item, ...result.conversation }
              : item,
          ),
        ),
      );
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : "重命名失败");
    }
  }

  async function onTogglePin(conversation: AiConversationSummary) {
    if (asking) return;

    setOpenHistoryMenu(null);
    try {
      const result = await updateAiConversation(conversation.id, {
        pinned: !conversation.pinned,
      });
      setConversations((current) =>
        sortConversations(
          current.map((item) =>
            item.id === conversation.id
              ? { ...item, ...result.conversation }
              : item,
          ),
        ),
      );
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : "更新置顶失败");
    }
  }

  function onQuickAsk(prompt: string) {
    if (asking || !aiStatus?.available) return;

    setQuestion(prompt);
    window.requestAnimationFrame(() => {
      questionInputRef.current?.form?.requestSubmit();
    });
  }

  function onRegenerateAnswer() {
    const previousQuestion = [...messages]
      .reverse()
      .find((message) => message.role === "user")?.content;
    if (previousQuestion) {
      onQuickAsk(`请重新回答这个问题，并改进准确性与结构：${previousQuestion}`);
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
          id="ai-history-drawer"
          aria-label="AI 历史记录"
        >
          <div className="ai-sidebar-primary">
            <button
              className={
                activeConversationId
                  ? "ai-sidebar-new"
                  : "ai-sidebar-new active"
              }
              disabled={asking}
              onClick={onNewConversation}
              type="button"
            >
              <Plus aria-hidden="true" />
              <span>新对话</span>
            </button>
            <label className="ai-history-search">
              <Search aria-hidden="true" />
              <input
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="搜索对话"
                value={historyQuery}
              />
            </label>
          </div>

          <div className="ai-sidebar-head">
            <h2>最近对话</h2>
            <span>{filteredConversations.length} 条</span>
          </div>
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
                        <strong>
                          {conversation.pinned ? (
                            <Pin aria-label="已置顶" className="history-pin" />
                          ) : null}
                          {conversation.title}
                        </strong>
                        <time>
                          {formatRelativeTime(conversation.updatedAt)}
                        </time>
                      </span>
                      <small>
                        {loadingConversationId === conversation.id
                          ? "加载中"
                          : conversation.lastMessagePreview || "暂无消息"}
                      </small>
                    </button>
                    <button
                      aria-expanded={openHistoryMenu?.id === conversation.id}
                      className="history-more-button row-more-button"
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
                          onClick={() =>
                            void onRenameConversation(conversation)
                          }
                          type="button"
                        >
                          <Pencil aria-hidden="true" />
                          重命名
                        </button>
                        <button
                          onClick={() => void onTogglePin(conversation)}
                          type="button"
                        >
                          {conversation.pinned ? (
                            <PinOff aria-hidden="true" />
                          ) : (
                            <Pin aria-hidden="true" />
                          )}
                          {conversation.pinned ? "取消置顶" : "置顶"}
                        </button>
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
            <div className="ai-chat-title">
              <button
                aria-controls="ai-history-drawer"
                aria-expanded={mobileHistoryOpen}
                aria-label="打开历史对话"
                className="ai-sidebar-toggle"
                onClick={() => setMobileHistoryOpen(true)}
                type="button"
              >
                <PanelLeft aria-hidden="true" />
              </button>
              <strong title={activeConversation?.title ?? "新对话"}>
                {activeConversation?.title ?? "新对话"}
              </strong>
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
              messages.map((message, index) => (
                <article
                  className={
                    message.role === "user"
                      ? "chat-bubble user"
                      : "chat-bubble assistant"
                  }
                  data-role={message.role}
                  key={message.id}
                >
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
                  <div className="chat-message-head">
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
                    {message.role === "assistant" &&
                    index === messages.length - 1 &&
                    message.content.trim() &&
                    !asking ? (
                      <>
                        <button
                          aria-label="重新生成回答"
                          className="chat-copy-button"
                          onClick={onRegenerateAnswer}
                          title="重新生成"
                          type="button"
                        >
                          <RefreshCcw aria-hidden="true" />
                          <span>重新生成</span>
                        </button>
                        <button
                          aria-label="继续回答"
                          className="chat-copy-button"
                          onClick={() => onQuickAsk("请继续上一条回答。")}
                          title="继续回答"
                          type="button"
                        >
                          <Plus aria-hidden="true" />
                          <span>继续回答</span>
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>

          {aiUnavailableReason ? (
            <p className="ai-inline-notice">{aiUnavailableReason}</p>
          ) : null}
          {aiError ? <p className="ai-inline-error">{aiError}</p> : null}

          <form className="home-ai-composer" onSubmit={onAsk}>
            <AutoTextarea
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
                  aria-label="发送消息"
                  className="button composer-send-button"
                  disabled={asking || !question.trim() || !aiStatus?.available}
                  type="submit"
                >
                  <Send aria-hidden="true" className="button-icon" />
                  <span>发送</span>
                </button>
              </div>
            </div>
          </form>
          <p className="ai-disclaimer">
            AI 生成内容可能有误，请核对引用的资料。
          </p>
        </section>
      </section>
    </div>
  );
}

function SourceList({ sources }: { sources: AiSourceSummary[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleSources = sources.slice(0, 4);
  const moreSources = sources.slice(4);

  return (
    <div className="chat-sources">
      {visibleSources.map((source) => renderSource(source))}
      {moreSources.length > 0 ? (
        <button
          aria-expanded={expanded}
          className="chat-source-more-button"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "收起其他来源" : `另有 ${moreSources.length} 个来源`}
        </button>
      ) : null}
      {expanded ? moreSources.map((source) => renderSource(source)) : null}
    </div>
  );
}

function renderSource(source: AiSourceSummary) {
  return (
    <Fragment key={source.id}>
      {source.unavailable ? (
        <span className="chat-source-link unavailable">文件不存在</span>
      ) : (
        <Link className="chat-source-link" href={contentDetail(source.id)}>
          {source.title}
        </Link>
      )}
    </Fragment>
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
  return sortConversations([
    nextConversation,
    ...conversations.filter(
      (conversation) => conversation.id !== nextConversation.id,
    ),
  ]);
}

function sortConversations(conversations: AiConversationSummary[]) {
  return [...conversations].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function getHistoryMenuPosition(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect();
  const menuWidth = 148;
  const menuHeight = 108;
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
