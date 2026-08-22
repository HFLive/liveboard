import { colors, radius, spacing } from "@/constants/theme";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

export function TextField({
  label,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...props}
      />
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  meta,
  onPress,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => pressed && styles.rowPressed}
    >
      {content}
    </Pressable>
  );
}

export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
    </View>
  );
}

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text
              style={[styles.segmentLabel, active && styles.segmentLabelActive]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function NoticeBanner({
  text,
  tone,
  onDismiss,
}: {
  text: string;
  tone: "success" | "error";
  onDismiss: () => void;
}) {
  return (
    <Pressable
      onPress={onDismiss}
      style={[
        styles.notice,
        tone === "error" ? styles.noticeError : styles.noticeSuccess,
      ]}
    >
      <Text style={styles.noticeText}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, color: colors.muted },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.fillSubtle,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, color: colors.text, fontWeight: "600" },
  rowSubtitle: { marginTop: 2, fontSize: 13, color: colors.muted },
  rowMeta: { fontSize: 12, color: colors.muted },
  rowPressed: { backgroundColor: colors.fillHover, borderRadius: radius.md },
  empty: { paddingVertical: 28, gap: 6 },
  emptyTitle: { fontSize: 16, color: colors.text, fontWeight: "600" },
  emptyDetail: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  segmented: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  segmentActive: { backgroundColor: colors.fillActive },
  segmentLabel: { fontSize: 14, color: colors.muted },
  segmentLabelActive: { color: colors.text, fontWeight: "600" },
  notice: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    padding: 12,
  },
  noticeError: { backgroundColor: colors.dangerSoft },
  noticeSuccess: { backgroundColor: colors.accentSoft },
  noticeText: { color: colors.text, fontSize: 14 },
});
