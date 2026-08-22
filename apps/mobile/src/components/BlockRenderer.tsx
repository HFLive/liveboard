import { colors, radius, spacing } from "@/constants/theme";
import type { ContentBlock } from "@/lib/api";
import { resolveResourceUrl } from "@/lib/api";
import { normalizeBilibiliEmbedUrl } from "@liveboard/shared/bilibili";
import { router } from "expo-router";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { MathView } from "./MathView";
import { RichText } from "./RichText";

function asBlockData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getText(block: ContentBlock) {
  const text = asBlockData(block.dataJson).text;
  return typeof text === "string" ? text : "";
}

function getString(block: ContentBlock, key: string) {
  const value = asBlockData(block.dataJson)[key];
  return typeof value === "string" ? value : "";
}

function lines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function tableRows(block: ContentBlock) {
  const value = asBlockData(block.dataJson).rows;
  if (!Array.isArray(value)) return [["", ""]];
  const rows = value
    .filter(Array.isArray)
    .map((row) => row.map((cell) => (typeof cell === "string" ? cell : "")));
  return rows.length > 0 ? rows : [["", ""]];
}

export function BlockRenderer({ block }: { block: ContentBlock }) {
  const text = getText(block);
  const data = asBlockData(block.dataJson);
  const rich = (value: string) => (
    <RichText enabled={data.inlineFormat === "markdown"} text={value} />
  );

  if (block.type.startsWith("heading_")) {
    const level = Number(block.type.slice(-1));
    return (
      <Text
        style={[styles.heading, { fontSize: Math.max(16, 28 - level * 2) }]}
      >
        {text || "未命名标题"}
      </Text>
    );
  }
  if (block.type === "bulleted_list" || block.type === "numbered_list") {
    return (
      <View style={styles.gap}>
        {lines(text).map((item, index) => (
          <Text key={`${item}-${index}`} style={styles.paragraph}>
            {block.type === "numbered_list" ? `${index + 1}. ` : "• "}
            {item}
          </Text>
        ))}
      </View>
    );
  }
  if (block.type === "todo") {
    return (
      <Text style={styles.paragraph}>
        {data.checked ? "☑ " : "☐ "}
        {text || "待办事项"}
      </Text>
    );
  }
  if (block.type === "quote") {
    return <View style={styles.quote}>{rich(text || "引用内容")}</View>;
  }
  if (block.type === "code") {
    return (
      <ScrollView horizontal style={styles.code}>
        <Text style={styles.codeText}>{text}</Text>
      </ScrollView>
    );
  }
  if (block.type === "divider") {
    return <View style={styles.divider} />;
  }
  if (block.type === "math") {
    return <MathView display expression={text || "\\text{空公式}"} />;
  }
  if (block.type === "table") {
    const rows = tableRows(block);
    return (
      <ScrollView horizontal>
        <View>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.tableRow}>
              {row.map((cell, cellIndex) => (
                <View key={cellIndex} style={styles.tableCell}>
                  <Text style={styles.cellText}>{cell}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }
  if (block.type === "image") {
    const url = getString(block, "url");
    return url ? (
      <AuthenticatedImage alt={text || "图片"} path={resolveResourceUrl(url)} />
    ) : (
      <Text style={styles.muted}>图片：{text || "等待上传"}</Text>
    );
  }
  if (block.type === "attachment") {
    const url = getString(block, "url");
    const filename = getString(block, "filename") || text || "附件";
    return url ? (
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/preview",
            params: { url: resolveResourceUrl(url), title: filename },
          })
        }
        style={styles.attachment}
      >
        <Text style={styles.attachmentTitle}>{filename}</Text>
        <Text style={styles.muted}>查看或下载</Text>
      </Pressable>
    ) : (
      <Text style={styles.muted}>附件：{text || "等待上传"}</Text>
    );
  }
  if (block.type === "bilibili") {
    const embedUrl = normalizeBilibiliEmbedUrl(getString(block, "embedCode"));
    if (!embedUrl) {
      return <Text style={styles.muted}>B站视频：等待有效嵌入代码</Text>;
    }
    const watchUrl = bilibiliWatchUrl(embedUrl);
    return (
      <View style={styles.video}>
        <WebView
          allowsFullscreenVideo
          source={{ uri: embedUrl }}
          style={styles.webview}
        />
        <Pressable onPress={() => void Linking.openURL(watchUrl)}>
          <Text style={styles.link}>在 B 站打开</Text>
        </Pressable>
      </View>
    );
  }
  if (block.type === "question") {
    return <Text style={styles.paragraph}>题目：{text || "待完善题干"}</Text>;
  }
  return <View>{rich(text)}</View>;
}

function bilibiliWatchUrl(embedUrl: string) {
  try {
    const url = new URL(embedUrl);
    const bvid = url.searchParams.get("bvid");
    const aid = url.searchParams.get("aid");
    const videoId = bvid ?? (aid ? `av${aid}` : "");
    return `https://www.bilibili.com/video/${encodeURIComponent(videoId)}`;
  } catch {
    return embedUrl;
  }
}

const styles = StyleSheet.create({
  heading: { fontWeight: "700", color: colors.text, marginVertical: 8 },
  paragraph: { fontSize: 16, lineHeight: 26, color: colors.text },
  gap: { gap: 6 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.md,
  },
  code: {
    backgroundColor: colors.code,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  codeText: { fontFamily: "Menlo", fontSize: 13, color: colors.text },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  tableRow: { flexDirection: "row" },
  tableCell: {
    minWidth: 88,
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
  },
  cellText: { fontSize: 13, color: colors.text },
  muted: { color: colors.muted },
  attachment: {
    backgroundColor: colors.fillSubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  attachmentTitle: { fontWeight: "600", color: colors.text },
  video: { height: 220, gap: 8 },
  webview: { flex: 1, borderRadius: radius.md, overflow: "hidden" },
  link: { color: colors.accentDark, fontWeight: "600" },
});
