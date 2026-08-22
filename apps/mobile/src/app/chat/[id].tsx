import { colors } from "@/constants/theme";
import { TextField } from "@/components/lists";
import { BodyText, PrimaryButton, Screen } from "@/components/ui";
import {
  askAiStream,
  getAiConversation,
  type AiMessageSummary,
} from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

export default function ChatScreen() {
  const { id, message: initialMessage } = useLocalSearchParams<{
    id: string;
    message?: string;
  }>();
  const { notify } = useSession();
  const started = useRef(false);
  const [title, setTitle] = useState("AI");
  const [messages, setMessages] = useState<AiMessageSummary[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState(
    id && id !== "new" ? id : undefined,
  );
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id || id === "new") return;
    getAiConversation(id)
      .then((result) => {
        setTitle(result.conversation.title);
        setMessages(result.conversation.messages);
        setConversationId(result.conversation.id);
      })
      .catch((caught) => {
        notify(caught instanceof Error ? caught.message : "无法打开对话");
      });
  }, [id, notify]);

  useEffect(() => {
    if (started.current || id !== "new" || !initialMessage) return;
    started.current = true;
    void send(initialMessage);
  }, [id, initialMessage]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setDraft("");
    setStreaming("");
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      await askAiStream(
        { message: content, conversationId },
        {
          onConversation: ({ conversation }) => {
            setConversationId(conversation.id);
            setTitle(conversation.title);
          },
          onDelta: (delta) => {
            setStreaming((current) => current + delta);
          },
          onMessage: (message) => {
            setMessages((current) => [...current, message]);
            setStreaming("");
          },
        },
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "AI 请求失败");
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(() => {
    if (!streaming) return messages;
    return [
      ...messages,
      {
        id: "streaming",
        role: "assistant" as const,
        content: streaming,
        createdAt: new Date().toISOString(),
      },
    ];
  }, [messages, streaming]);

  return (
    <Screen safeTop={false}>
      <Stack.Screen options={{ title }} />
      {visible.length === 0 && !busy ? (
        <BodyText muted>向 AI 提问当前能访问的文档。</BodyText>
      ) : null}
      {visible.map((item) => (
        <View
          key={item.id}
          style={{
            alignSelf: item.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "92%",
            backgroundColor:
              item.role === "user" ? colors.fillActive : "transparent",
            borderRadius: 12,
            padding: 10,
          }}
        >
          <Text style={{ fontSize: 16, lineHeight: 24, color: colors.text }}>
            {item.content}
          </Text>
          {item.sources?.length ? (
            <Text style={{ marginTop: 6, color: colors.muted, fontSize: 12 }}>
              参考：{item.sources.map((source) => source.title).join("、")}
            </Text>
          ) : null}
        </View>
      ))}
      {busy && !streaming ? <ActivityIndicator /> : null}
      <TextField
        label="继续提问"
        multiline
        onChangeText={setDraft}
        value={draft}
      />
      <PrimaryButton
        disabled={!draft.trim() || busy}
        label="发送"
        loading={busy}
        onPress={() => void send(draft)}
      />
    </Screen>
  );
}
