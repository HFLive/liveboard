import { NoticeBanner } from "@/components/lists";
import { colors } from "@/constants/theme";
import { SessionProvider, useSession } from "@/lib/session/SessionProvider";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <StatusBar style="dark" />
        <RootNotice />
        <Stack
          screenOptions={{
            headerBackTitle: "返回",
            headerShadowVisible: false,
            headerLargeTitleEnabled: false,
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: {
              fontSize: 17,
              fontWeight: "600",
              color: colors.text,
            },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="classroom/[id]" options={{ title: "课堂" }} />
          <Stack.Screen name="document/[id]" options={{ title: "文档" }} />
          <Stack.Screen name="exercise/[id]" options={{ title: "练习" }} />
          <Stack.Screen name="thread/[id]" options={{ title: "帖子" }} />
          <Stack.Screen name="thread/new" options={{ title: "发帖" }} />
          <Stack.Screen name="deck/[id]" options={{ title: "课件" }} />
          <Stack.Screen name="chat/[id]" options={{ title: "AI" }} />
          <Stack.Screen name="preview" options={{ title: "文件" }} />
        </Stack>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}

function RootNotice() {
  const { notice, clearNotice } = useSession();
  if (!notice) return null;
  return (
    <NoticeBanner
      text={notice.text}
      tone={notice.tone}
      onDismiss={clearNotice}
    />
  );
}
