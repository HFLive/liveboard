import { TextField } from "@/components/lists";
import { PrimaryButton, Screen } from "@/components/ui";
import {
  createForumThread,
  listForumOverview,
  type ForumCategorySummary,
} from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "@/constants/theme";

export default function NewThreadScreen() {
  const { notify } = useSession();
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listForumOverview()
      .then((result) => {
        setCategories(result.categories);
        setCategoryId(result.categories[0]?.id ?? "");
      })
      .catch((caught) => {
        notify(caught instanceof Error ? caught.message : "无法加载版块");
      });
  }, [notify]);

  return (
    <Screen safeTop={false}>
      <View style={styles.wrap}>
        {categories.map((category) => (
          <Pressable
            key={category.id}
            onPress={() => setCategoryId(category.id)}
            style={[
              styles.chip,
              category.id === categoryId && styles.chipActive,
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                category.id === categoryId && styles.chipLabelActive,
              ]}
            >
              {category.name}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextField label="标题" onChangeText={setTitle} value={title} />
      <TextField label="正文" multiline onChangeText={setBody} value={body} />
      <Pressable onPress={() => setAnonymous((current) => !current)}>
        <Text style={styles.anon}>
          {anonymous ? "☑ 匿名发布" : "☐ 匿名发布"}
        </Text>
      </Pressable>
      <PrimaryButton
        disabled={!title.trim() || !body.trim() || !categoryId}
        label="发布主题"
        loading={loading}
        onPress={() => {
          setLoading(true);
          createForumThread({
            categoryId,
            title: title.trim(),
            body: body.trim(),
            isAnonymous: anonymous,
          })
            .then((result) => {
              router.replace({
                pathname: "/thread/[id]",
                params: { id: result.thread.id },
              });
            })
            .catch((caught) => {
              notify(caught instanceof Error ? caught.message : "发布失败");
            })
            .finally(() => setLoading(false));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  chipActive: { backgroundColor: colors.fillActive },
  chipLabel: { color: colors.muted },
  chipLabelActive: { color: colors.text, fontWeight: "600" },
  anon: { fontSize: 15, color: colors.textSoft, minHeight: 44 },
});
