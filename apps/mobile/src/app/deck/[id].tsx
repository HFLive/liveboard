import { BlockRenderer } from "@/components/BlockRenderer";
import { EmptyState, ListRow } from "@/components/lists";
import { Screen } from "@/components/ui";
import { getTeachingDeck, type TeachingDeckDetail } from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

export default function DeckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { notify } = useSession();
  const [deck, setDeck] = useState<TeachingDeckDetail | null>(null);

  useEffect(() => {
    if (!id) return;
    getTeachingDeck(id)
      .then((result) => setDeck(result.deck))
      .catch((caught) => {
        notify(caught instanceof Error ? caught.message : "无法打开课件");
      });
  }, [id, notify]);

  if (!deck) {
    return (
      <Screen scroll={false} safeTop={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen safeTop={false}>
      <Stack.Screen options={{ title: deck.title }} />
      {deck.items.length === 0 ? (
        <EmptyState title="这份课件还没有内容" />
      ) : null}
      <View style={{ gap: 16 }}>
        {deck.items.map((item) =>
          item.type === "exercise" && item.exerciseSetId ? (
            <ListRow
              key={item.id}
              onPress={() =>
                router.push({
                  pathname: "/exercise/[id]",
                  params: { id: item.exerciseSetId! },
                })
              }
              subtitle="课堂练习"
              title={item.exerciseTitle || "练习"}
            />
          ) : item.block ? (
            <BlockRenderer block={item.block} key={item.id} />
          ) : null,
        )}
      </View>
    </Screen>
  );
}
