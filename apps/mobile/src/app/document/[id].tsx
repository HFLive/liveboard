import { BlockRenderer } from "@/components/BlockRenderer";
import { EmptyState } from "@/components/lists";
import { Screen } from "@/components/ui";
import {
  getFile,
  listBlocks,
  type ContentBlock,
  type FileDetail,
} from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { notify } = useSession();
  const [file, setFile] = useState<FileDetail | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.all([getFile(id), listBlocks(id)])
      .then(([fileResult, blockResult]) => {
        if (!active) return;
        setFile(fileResult.file);
        setBlocks(blockResult.blocks);
      })
      .catch((caught) => {
        notify(caught instanceof Error ? caught.message : "无法打开文档");
      });
    return () => {
      active = false;
    };
  }, [id, notify]);

  if (!file) {
    return (
      <Screen scroll={false} safeTop={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen safeTop={false}>
      <Stack.Screen options={{ title: file.title }} />
      {blocks.length === 0 ? (
        <EmptyState title="这篇文档还没有内容" />
      ) : (
        <View style={{ gap: 16 }}>
          {blocks.map((block) => (
            <BlockRenderer block={block} key={block.id} />
          ))}
        </View>
      )}
    </Screen>
  );
}
