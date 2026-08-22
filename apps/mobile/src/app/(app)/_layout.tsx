import { colors } from "@/constants/theme";
import { useSession } from "@/lib/session/SessionProvider";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";

export default function AppTabs() {
  const { user, ready } = useSession();
  if (ready && !user) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentDark,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.line,
        },
      }}
    >
      <Tabs.Screen
        name="classrooms/index"
        options={{
          title: "课堂",
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="albums-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="content/index"
        options={{
          title: "文档",
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="document-text-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="forum/index"
        options={{
          title: "论坛",
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="chatbubbles-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai/index"
        options={{
          title: "AI",
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="color-wand-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="me/index"
        options={{
          title: "我的",
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="person-outline" size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
