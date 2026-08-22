import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/constants/theme";

export function Screen({
  children,
  scroll = true,
  padded = true,
  safeTop = true,
  style,
}: ViewProps & { scroll?: boolean; padded?: boolean; safeTop?: boolean }) {
  const body = (
    <View style={[styles.body, padded && styles.padded, style]}>
      {children}
    </View>
  );
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      {body}
    </ScrollView>
  ) : (
    body
  );
  if (!safeTop) {
    return <View style={styles.safe}>{content}</View>;
  }
  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      {content}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function BodyText({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <Text style={[styles.bodyText, muted && styles.muted]}>{children}</Text>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        danger && styles.danger,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.buttonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.ghost}>
      <Text style={styles.ghostLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  body: { flex: 1 },
  padded: { padding: spacing.lg, gap: spacing.md },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
  },
  bodyText: { fontSize: 15, lineHeight: 22, color: colors.textSoft },
  muted: { color: colors.muted },
  button: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.86 },
  buttonLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
  ghost: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  ghostLabel: { color: colors.accentDark, fontSize: 15, fontWeight: "600" },
});
