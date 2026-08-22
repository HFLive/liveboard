import { TextField } from "@/components/lists";
import {
  BodyText,
  GhostButton,
  PrimaryButton,
  Screen,
  Title,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import { router } from "expo-router";
import { useState } from "react";

export default function LoginScreen() {
  const { capabilities, login, notify, serverUrl } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const localLogin = capabilities?.localLogin !== false;
  const breakglass = Boolean(capabilities?.breakglass);

  async function submit(emergency = false) {
    setLoading(true);
    try {
      await login(username.trim(), password, emergency);
      router.replace("/(app)/classrooms");
    } catch (caught) {
      notify(
        caught instanceof ApiError && caught.status === 401
          ? emergency
            ? "紧急登录失败，请确认最高管理员凭据"
            : "账号或密码错误"
          : caught instanceof Error
            ? caught.message
            : "登录失败",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Title>登录</Title>
      <BodyText muted>{serverUrl ?? ""}</BodyText>
      {capabilities?.hfliveOidc && !localLogin ? (
        <BodyText>
          当前工作区只启用了 HFLive
          统一登录。请先在网页完成登录，或让管理员打开本地账号。
        </BodyText>
      ) : null}
      {localLogin ? (
        <>
          <TextField
            autoComplete="username"
            label="用户名"
            onChangeText={setUsername}
            value={username}
          />
          <TextField
            autoComplete="password"
            label="密码"
            onChangeText={setPassword}
            secureTextEntry
            value={password}
          />
          <PrimaryButton
            label="登录"
            loading={loading}
            onPress={() => void submit()}
          />
        </>
      ) : null}
      {breakglass ? (
        <PrimaryButton
          danger
          label="紧急登录"
          loading={loading}
          onPress={() => void submit(true)}
        />
      ) : null}
      <GhostButton
        label="更换服务器"
        onPress={() => router.replace("/(auth)/server")}
      />
    </Screen>
  );
}
