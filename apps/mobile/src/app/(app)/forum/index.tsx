import { EmptyState, ListRow } from "@/components/lists";
import { PrimaryButton, Screen } from "@/components/ui";
import { listForumOverview, type ForumThreadSummary } from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator } from "react-native";

export default function ForumScreen() {
  const { notify } = useSession();
  const [threads, setThreads] = useState<ForumThreadSummary[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listForumOverview()
        .then((result) => {
          if (active) setThreads(result.threads);
        })
        .catch((caught) => {
          notify(caught instanceof Error ? caught.message : "无法加载论坛");
        });
      return () => {
        active = false;
      };
    }, [notify]),
  );

  if (!threads) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen>
      <PrimaryButton
        label="发布主题"
        onPress={() => router.push("/thread/new")}
      />
      {threads.length === 0 ? (
        <EmptyState title="还没有帖子" detail="发布主题开始讨论。" />
      ) : (
        threads.map((thread) => (
          <ListRow
            key={thread.id}
            onPress={() =>
              router.push({
                pathname: "/thread/[id]",
                params: { id: thread.id },
              })
            }
            subtitle={thread.excerpt}
            title={thread.title}
          />
        ))
      )}
    </Screen>
  );
}
