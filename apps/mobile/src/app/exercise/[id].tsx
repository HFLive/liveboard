import { EmptyState, TextField } from "@/components/lists";
import { BodyText, PrimaryButton, Screen } from "@/components/ui";
import {
  getExerciseSet,
  submitExerciseSet,
  type ExerciseQuestion,
  type ExerciseSetDetail,
} from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radius } from "@/constants/theme";

export default function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { notify } = useSession();
  const [set, setSet] = useState<ExerciseSetDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<{
    status: string;
    score: number | null;
    maxScore: number;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    getExerciseSet(id)
      .then((response) => setSet(response.exerciseSet))
      .catch((caught) => {
        notify(caught instanceof Error ? caught.message : "无法打开练习");
      });
  }, [id, notify]);

  if (!set) {
    return (
      <Screen scroll={false} safeTop={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen safeTop={false}>
      <Stack.Screen options={{ title: set.title }} />
      {result ? (
        <EmptyState
          title={`已提交：${result.score ?? "待批改"} / ${result.maxScore}`}
          detail={result.status}
        />
      ) : null}
      {set.questions.map((question, index) => (
        <QuestionCard
          key={question.id}
          index={index}
          onChange={(value) =>
            setAnswers((current) => ({ ...current, [question.id]: value }))
          }
          question={question}
          value={answers[question.id]}
        />
      ))}
      <PrimaryButton
        label="提交"
        onPress={() => {
          Alert.alert("提交练习", "提交后不可再改本题答案。", [
            { text: "取消", style: "cancel" },
            {
              text: "提交",
              onPress: () => {
                void submitExerciseSet(
                  set.id,
                  set.questions.map((question) => ({
                    questionId: question.id,
                    answerJson: answers[question.id] ?? null,
                  })),
                )
                  .then((response) => {
                    setResult(response.submission);
                    notify("已提交", "success");
                  })
                  .catch((caught) => {
                    notify(
                      caught instanceof Error ? caught.message : "提交失败",
                    );
                  });
              },
            },
          ]);
        }}
      />
    </Screen>
  );
}

function QuestionCard({
  question,
  index,
  value,
  onChange,
}: {
  question: ExerciseQuestion;
  index: number;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const prompt =
    question.promptJson &&
    typeof question.promptJson === "object" &&
    "text" in question.promptJson
      ? String(question.promptJson.text ?? "")
      : "";
  const options =
    question.optionsJson &&
    typeof question.optionsJson === "object" &&
    "options" in question.optionsJson &&
    Array.isArray(question.optionsJson.options)
      ? question.optionsJson.options.filter(
          (item): item is string => typeof item === "string",
        )
      : [];

  return (
    <View style={styles.card}>
      <BodyText>
        {index + 1}. {prompt}（{question.score} 分）
      </BodyText>
      {question.type === "true_false"
        ? ["true", "false"].map((option) => (
            <Choice
              key={option}
              active={value === option}
              label={option === "true" ? "正确" : "错误"}
              onPress={() => onChange(option)}
            />
          ))
        : null}
      {question.type === "single_choice"
        ? options.map((option) => (
            <Choice
              key={option}
              active={value === option}
              label={option}
              onPress={() => onChange(option)}
            />
          ))
        : null}
      {question.type === "multiple_choice"
        ? options.map((option) => {
            const selected = Array.isArray(value)
              ? value.includes(option)
              : false;
            return (
              <Choice
                key={option}
                active={selected}
                label={option}
                onPress={() => {
                  const current = Array.isArray(value)
                    ? value.filter((item) => typeof item === "string")
                    : [];
                  onChange(
                    selected
                      ? current.filter((item) => item !== option)
                      : [...current, option],
                  );
                }}
              />
            );
          })
        : null}
      {question.type === "fill_blank" || question.type === "short_answer" ? (
        <TextField
          label="作答"
          onChangeText={(text) => onChange(text)}
          value={typeof value === "string" ? value : ""}
        />
      ) : null}
    </View>
  );
}

function Choice({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.choice, active && styles.choiceActive]}
    >
      <Text style={[styles.choiceLabel, active && styles.choiceLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, paddingVertical: 8 },
  choice: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  choiceActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  choiceLabel: { color: colors.text, fontSize: 15 },
  choiceLabelActive: { fontWeight: "600" },
});
