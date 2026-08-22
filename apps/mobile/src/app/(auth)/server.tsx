import { EmptyState, TextField } from "@/components/lists";
import { BodyText, PrimaryButton, Screen, Title } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { defaultServerUrl, isLikelyLocalHost } from "@/lib/server-url";
import { useSession } from "@/lib/session/SessionProvider";
import { router } from "expo-router";
import { useState } from "react";
import { Platform } from "react-native";

export default function ServerScreen() {
  const { serverUrl, setServerUrl, notify } = useSession();
  const [value, setValue] = useState(serverUrl ?? defaultServerUrl());
  const [loading, setLoading] = useState(false);

  return (
    <Screen>
      <Title>连接服务器</Title>
      <BodyText>
        填写自托管 LiveBoard 的 API 地址，例如 https://board.example.com
        或局域网 http://192.168.1.8:4000。
      </BodyText>
      <TextField
        autoComplete="off"
        keyboardType="url"
        label="服务器地址"
        onChangeText={setValue}
        placeholder="http://192.168.1.8:4000"
        value={value}
      />
      {Platform.OS === "android" && isLikelyLocalHost(value) ? (
        <EmptyState
          title="Android 模拟器请改用 10.0.2.2"
          detail="真机请填写电脑的局域网 IP，不要使用 localhost。"
        />
      ) : null}
      <PrimaryButton
        label="连接并继续"
        loading={loading}
        onPress={() => {
          setLoading(true);
          setServerUrl(value)
            .then(() => router.replace("/(auth)/login"))
            .catch((caught) => {
              notify(
                caught instanceof ApiError
                  ? "无法访问该地址，请确认 API 已启动"
                  : caught instanceof Error
                    ? caught.message
                    : "无法连接服务器",
              );
            })
            .finally(() => setLoading(false));
        }}
      />
    </Screen>
  );
}
