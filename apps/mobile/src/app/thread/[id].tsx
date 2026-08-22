import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { EmptyState, TextField } from "@/components/lists";
import { BodyText, GhostButton, PrimaryButton, Screen } from "@/components/ui";
import {
  createForumPost,
  getForumThread,
  resolveResourceUrl,
  voteForumPost,
  type ForumThreadDetail,
} from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { notify } = useSession();
  const [thread, setThread] = useState<ForumThreadDetail | null>(null);
  const [reply, setReply] = useState("");

  async function reload() {
    if (!id) return;
    const result = await getForumThread(id);
    setThread(result.thread);
  }

  useEffect(() => {
    reload().catch((caught) => {
      notify(caught instanceof Error ? caught.message : "无法打开帖子");
    });
  }, [id, notify]);

  if (!thread) {
    return (
      <Screen scroll={false} safeTop={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen safeTop={false}>
      <Stack.Screen options={{ title: thread.title }} />
      {thread.posts.map((post) => (
        <View key={post.id} style={{ gap: 8, paddingVertical: 12 }}>
          <BodyText muted>
            {post.isAnonymous ? "匿名" : post.author.displayName}
          </BodyText>
          <BodyText>{post.body}</BodyText>
          {post.images.map((image) => (
            <AuthenticatedImage
              key={image.id}
              alt="论坛图片"
              height={160}
              path={resolveResourceUrl(image.url)}
            />
          ))}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <GhostButton
              label={`赞 ${post.upvoteCount}`}
              onPress={() =>
                void voteForumPost(post.id, "up")
                  .then(reload)
                  .catch((caught) => {
                    notify(
                      caught instanceof Error ? caught.message : "操作失败",
                    );
                  })
              }
            />
            <GhostButton
              label={`踩 ${post.downvoteCount}`}
              onPress={() =>
                void voteForumPost(post.id, "down")
                  .then(reload)
                  .catch((caught) => {
                    notify(
                      caught instanceof Error ? caught.message : "操作失败",
                    );
                  })
              }
            />
          </View>
        </View>
      ))}
      {thread.canReply ? (
        <>
          <TextField
            label="回复"
            multiline
            onChangeText={setReply}
            value={reply}
          />
          <PrimaryButton
            disabled={!reply.trim()}
            label="发布回复"
            onPress={() => {
              void createForumPost(thread.id, { body: reply.trim() })
                .then(() => {
                  setReply("");
                  return reload();
                })
                .catch((caught) => {
                  notify(caught instanceof Error ? caught.message : "回复失败");
                });
            }}
          />
        </>
      ) : (
        <EmptyState title="帖子已锁定，不能回复" />
      )}
    </Screen>
  );
}
