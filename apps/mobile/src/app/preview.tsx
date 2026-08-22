import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { BodyText, PrimaryButton, Screen } from "@/components/ui";
import { apiUrl, authHeaders, fetchPreviewUrl, requestBlob } from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text } from "react-native";
import { WebView } from "react-native-webview";

export default function PreviewScreen() {
  const params = useLocalSearchParams<{
    kind?: string;
    id?: string;
    classroomId?: string;
    title?: string;
    mimeType?: string;
    url?: string;
  }>();
  const { notify } = useSession();
  const [text, setText] = useState<string | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [directUrl, setDirectUrl] = useState<string | null>(null);
  const title = params.title || "文件";
  const mime = params.mimeType ?? "";
  const previewPath = useMemo(() => {
    if (params.url) return null;
    if (params.kind === "classroom" && params.classroomId && params.id) {
      return `/classrooms/${params.classroomId}/files/${params.id}`;
    }
    if (params.id) return `/assets/${params.id}`;
    return null;
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (params.url && looksLikeImage(mime, title)) {
          return;
        }
        if (previewPath) {
          const signed = await fetchPreviewUrl(
            `${previewPath}/preview-url`,
          ).catch(() => ({ url: null }));
          if (!cancelled && signed.url) {
            setDirectUrl(signed.url);
            return;
          }
          if (looksLikeText(mime, title)) {
            const response = await requestBlob(`${previewPath}/preview`);
            const body = await response.text();
            if (!cancelled) setText(body);
            return;
          }
        }
        const downloadPath = params.url
          ? params.url
          : `${previewPath}?download=1`;
        if (!downloadPath) return;
        const target = `${FileSystem.cacheDirectory}${encodeURIComponent(title)}`;
        const result = await FileSystem.downloadAsync(
          downloadPath.startsWith("http") ? downloadPath : apiUrl(downloadPath),
          target,
          { headers: authHeaders() },
        );
        if (!cancelled) setLocalUri(result.uri);
      } catch (caught) {
        if (!cancelled) {
          notify(caught instanceof Error ? caught.message : "无法预览文件");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mime, notify, params.url, previewPath, title]);

  const imagePath =
    looksLikeImage(mime, title) && (params.url || previewPath)
      ? params.url || previewPath || ""
      : null;

  return (
    <Screen scroll={false} padded={false} safeTop={false}>
      <Stack.Screen options={{ title }} />
      <Screen safeTop={false}>
        {imagePath ? (
          <AuthenticatedImage alt={title} height={280} path={imagePath} />
        ) : null}
        {text ? (
          <ScrollView>
            <Text selectable style={{ fontSize: 15, lineHeight: 24 }}>
              {text}
            </Text>
          </ScrollView>
        ) : null}
        {directUrl && looksLikePdf(mime, title) ? (
          <WebView
            source={{ uri: directUrl }}
            style={{ flex: 1, minHeight: 360 }}
          />
        ) : null}
        {localUri && looksLikePdf(mime, title) && !directUrl ? (
          <WebView
            source={{ uri: localUri }}
            style={{ flex: 1, minHeight: 360 }}
          />
        ) : null}
        {!imagePath && !text && !directUrl && !localUri ? (
          <ActivityIndicator />
        ) : null}
        {localUri ? (
          <PrimaryButton
            label="分享或用其他应用打开"
            onPress={() =>
              void Sharing.shareAsync(localUri).catch((caught) => {
                notify(caught instanceof Error ? caught.message : "无法分享");
              })
            }
          />
        ) : (
          <BodyText muted>不支持的格式可以下载后用系统应用打开。</BodyText>
        )}
      </Screen>
    </Screen>
  );
}

function looksLikeImage(mime: string, name: string) {
  return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name);
}

function looksLikePdf(mime: string, name: string) {
  return mime.includes("pdf") || /\.pdf$/i.test(name);
}

function looksLikeText(mime: string, name: string) {
  return (
    mime.startsWith("text/") ||
    mime.includes("markdown") ||
    /\.(md|txt)$/i.test(name)
  );
}
