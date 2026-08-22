import {
  BodyText,
  GhostButton,
  PrimaryButton,
  Screen,
  Title,
} from "@/components/ui";
import { useSession } from "@/lib/session/SessionProvider";
import { router } from "expo-router";

export default function MeScreen() {
  const { user, serverUrl, logout } = useSession();

  return (
    <Screen>
      <Title>{user?.displayName ?? "未登录"}</Title>
      <BodyText muted>@{user?.username}</BodyText>
      <BodyText muted>{serverUrl}</BodyText>
      <GhostButton
        label="更换服务器"
        onPress={() => router.push("/(auth)/server")}
      />
      <PrimaryButton
        danger
        label="退出登录"
        onPress={() => {
          void logout().then(() => router.replace("/(auth)/login"));
        }}
      />
    </Screen>
  );
}
