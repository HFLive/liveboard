import { ApiError } from "./client";
import type {
  AiConversationSummary,
  AiMessageSummary,
  AiSourceSummary,
} from "./types";

export interface AiStreamHandlers {
  onConversation?: (payload: {
    conversation: AiConversationSummary;
    userMessage: AiMessageSummary;
  }) => void;
  onSources?: (sources: AiSourceSummary[]) => void;
  onDelta: (delta: string) => void;
  onMessage?: (message: AiMessageSummary) => void;
}

export function handleAiStreamLine(line: string, handlers: AiStreamHandlers) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const event = JSON.parse(trimmed) as
    | {
        type: "conversation";
        conversation: AiConversationSummary;
        userMessage: AiMessageSummary;
      }
    | { type: "sources"; sources: AiSourceSummary[] }
    | { type: "delta"; delta: string }
    | { type: "message"; message: AiMessageSummary }
    | { type: "error"; message: string }
    | { type: "done" };

  if (event.type === "conversation") {
    handlers.onConversation?.({
      conversation: event.conversation,
      userMessage: event.userMessage,
    });
    return;
  }
  if (event.type === "sources") {
    handlers.onSources?.(event.sources);
    return;
  }
  if (event.type === "delta") {
    handlers.onDelta(event.delta);
    return;
  }
  if (event.type === "message") {
    handlers.onMessage?.(event.message);
    return;
  }
  if (event.type === "error") {
    throw new ApiError(event.message, 502);
  }
}

export async function consumeAiStream(
  body: ReadableStream<Uint8Array>,
  handlers: AiStreamHandlers,
) {
  const reader = body.getReader();
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
      handleAiStreamLine(line, handlers);
    }
  }

  if (buffer.trim()) {
    handleAiStreamLine(buffer, handlers);
  }
}
