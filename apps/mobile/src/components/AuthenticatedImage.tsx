import { colors } from "@/constants/theme";
import { apiUrl, authHeaders } from "@/lib/api";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

export function AuthenticatedImage({
  path,
  alt,
  height = 180,
}: {
  path: string;
  alt: string;
  height?: number;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          path.startsWith("http") ? path : apiUrl(path),
          {
            headers: authHeaders(),
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("image");
        const blob = await response.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (!cancelled) setUri(dataUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path]);

  if (error) {
    return (
      <View style={[styles.fallback, { height }]}>
        <Text style={styles.fallbackText}>{alt}</Text>
      </View>
    );
  }

  if (!uri) {
    return <View style={[styles.fallback, { height }]} />;
  }

  return (
    <Image
      accessibilityLabel={alt}
      contentFit="contain"
      source={{ uri }}
      style={[styles.image, { height }]}
    />
  );
}

const styles = StyleSheet.create({
  image: { width: "100%", borderRadius: 8, backgroundColor: colors.fillSubtle },
  fallback: {
    width: "100%",
    borderRadius: 8,
    backgroundColor: colors.fillSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: { color: colors.muted, fontSize: 13 },
});
