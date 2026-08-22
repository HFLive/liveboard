import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { handleAiStreamLine } from "./stream";

describe("handleAiStreamLine", () => {
  it("dispatches conversation, delta and message events", () => {
    const deltas: string[] = [];
    const conversation = {
      id: "c1",
      title: "问文档",
      createdAt: "",
      updatedAt: "",
    };
    const userMessage = {
      id: "m1",
      role: "user" as const,
      content: "你好",
      createdAt: "",
    };
    let receivedConversation = false;
    let receivedMessage = false;

    handleAiStreamLine(
      JSON.stringify({ type: "conversation", conversation, userMessage }),
      {
        onConversation: () => {
          receivedConversation = true;
        },
        onDelta: (delta) => deltas.push(delta),
      },
    );
    handleAiStreamLine(JSON.stringify({ type: "delta", delta: "你好" }), {
      onDelta: (delta) => deltas.push(delta),
    });
    handleAiStreamLine(
      JSON.stringify({
        type: "message",
        message: {
          id: "m2",
          role: "assistant",
          content: "你好",
          createdAt: "",
        },
      }),
      {
        onDelta: () => undefined,
        onMessage: () => {
          receivedMessage = true;
        },
      },
    );

    expect(receivedConversation).toBe(true);
    expect(deltas).toEqual(["你好"]);
    expect(receivedMessage).toBe(true);
  });

  it("turns server error events into ApiError", () => {
    expect(() =>
      handleAiStreamLine(JSON.stringify({ type: "error", message: "超额" }), {
        onDelta: () => undefined,
      }),
    ).toThrow(ApiError);
  });
});
