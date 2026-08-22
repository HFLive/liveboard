import { colors } from "@/constants/theme";
import katex from "katex";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

export function MathView({
  expression,
  display = false,
}: {
  expression: string;
  display?: boolean;
}) {
  const html = useMemo(() => {
    const rendered = katex.renderToString(expression, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: "ignore",
      maxExpand: 1000,
      maxSize: 10,
    });
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      html,body{margin:0;padding:0;background:transparent;color:#24231f;font-size:16px;}
      .katex{font-size:1.05em;}
    </style>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.css">
    </head><body>${rendered}</body></html>`;
  }, [display, expression]);

  return (
    <View style={display ? styles.block : styles.inline}>
      <WebView
        originWhitelist={["*"]}
        scrollEnabled={false}
        source={{ html, baseUrl: "https://localhost" }}
        style={display ? styles.blockWeb : styles.inlineWeb}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inline: { height: 28, minWidth: 48 },
  block: { height: 72, backgroundColor: colors.fillSubtle, borderRadius: 8 },
  inlineWeb: { backgroundColor: "transparent", flex: 1 },
  blockWeb: { backgroundColor: "transparent", flex: 1 },
});
