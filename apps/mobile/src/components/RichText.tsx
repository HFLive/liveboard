import { colors } from "@/constants/theme";
import { isSafeRichTextHref } from "@/lib/rich-text";
import { Fragment, type ReactNode } from "react";
import { Linking, StyleSheet, Text } from "react-native";
import { MathView } from "./MathView";

const INLINE_PATTERN_SOURCE =
  "(`+)([^\\n]*?)\\1|\\[([^\\]]+)\\]\\(([^\\s)]+)\\)|\\*\\*([^\\n*]+)\\*\\*|__([^\\n_]+)__|~~([^\\n~]+)~~|\\*([^\\n*]+)\\*|_([^\\n_]+)_|\\$([^$\\n]+)\\$";

export function RichText({
  text,
  enabled,
}: {
  text: string;
  enabled: boolean;
}) {
  if (!enabled) return <Text style={styles.text}>{text}</Text>;
  return <Text style={styles.text}>{renderInline(text)}</Text>;
}

function renderInline(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE_PATTERN_SOURCE, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }
    const key = `${match.index}-${match[0]}`;
    if (match[2] !== undefined) {
      nodes.push(
        <Text key={key} style={styles.code}>
          {match[2]}
        </Text>,
      );
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const href = match[4];
      nodes.push(
        isSafeRichTextHref(href) ? (
          <Text
            key={key}
            onPress={() => {
              if (href.startsWith("http")) void Linking.openURL(href);
            }}
            style={styles.link}
          >
            {match[3]}
          </Text>
        ) : (
          <Fragment key={key}>{match[3]}（不安全链接）</Fragment>
        ),
      );
    } else if (match[5] !== undefined || match[6] !== undefined) {
      nodes.push(
        <Text key={key} style={styles.bold}>
          {match[5] ?? match[6]}
        </Text>,
      );
    } else if (match[7] !== undefined) {
      nodes.push(
        <Text key={key} style={styles.strike}>
          {match[7]}
        </Text>,
      );
    } else if (match[8] !== undefined || match[9] !== undefined) {
      nodes.push(
        <Text key={key} style={styles.italic}>
          {match[8] ?? match[9]}
        </Text>,
      );
    } else if (match[10] !== undefined) {
      nodes.push(<MathView expression={match[10]} key={key} />);
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

const styles = StyleSheet.create({
  text: { color: "#24231f", fontSize: 16, lineHeight: 26 },
  code: {
    fontFamily: "Menlo",
    backgroundColor: colors.code,
    fontSize: 14,
  },
  link: { color: colors.accentDark, textDecorationLine: "underline" },
  bold: { fontWeight: "700" },
  strike: { textDecorationLine: "line-through" },
  italic: { fontStyle: "italic" },
});
