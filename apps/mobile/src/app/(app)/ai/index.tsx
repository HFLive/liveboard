import { EmptyState, ListRow, TextField } from "@/components/lists";
import { BodyText, PrimaryButton, Screen } from "@/components/ui";
import {
  getAiStatus,
  getAiUsage,
  listAiConversations,
  type AiConversationSummary,
  type AiStatus,
} from "@/lib/api";
import type { AiUsageSummary } from "@liveboard/shared";
import { useSession } from "@/lib/session/SessionProvider";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator } from "react-native";

export default function AiScreen() {
  const { notify } = useSession();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [items, setItems] = useState<AiConversationSummary[] | null>(null);
  const [draft, setDraft] = useState("");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([getAiStatus(), getAiUsage(), listAiConversations()])
        .then(([statusResult, usageResult, conversations]) => {
          if (!active) return;
          setStatus(statusResult.status);
          setUsage(usageResult);
          setItems(conversations.conversations);
        })
        .catch((caught) => {
          notify(caught instanceof Error ? caught.message : "无法加载 AI");
        });
      return () => {
        active = false;
      };
    }, [notify]),
  );

  if (!items || !status) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!status.enabled || !status.configured) {
    return (
      <Screen>
        <EmptyState
          title="AI 尚未启用"
          detail={status.reason ?? "请管理员在网页管理中心配置模型。"}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {usage ? (
        <BodyText muted>
          今日 AI {usage.used}/{usage.limit}
        </BodyText>
      ) : null}
      <TextField
        label="提问"
        multiline
        onChangeText={setDraft}
        placeholder="输入问题"
        value={draft}
      />
      <PrimaryButton
        disabled={!draft.trim()}
        label="开始对话"
        onPress={() =>
          router.push({
            pathname: "/chat/[id]",
            params: { id: "new", message: draft.trim() },
          })
        }
      />
      {items.length === 0 ? (
        <EmptyState title="还没有对话" />
      ) : (
        items.map((item) => (
          <ListRow
            key={item.id}
            onPress={() =>
              router.push({ pathname: "/chat/[id]", params: { id: item.id } })
            }
            subtitle={item.lastMessagePreview}
            title={item.title}
          />
        ))
      )}
    </Screen>
  );
}
