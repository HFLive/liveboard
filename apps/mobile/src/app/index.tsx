import { useSession } from "@/lib/session/SessionProvider";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

export default function Index() {
  const { ready, user, serverUrl } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!serverUrl) return <Redirect href="/(auth)/server" />;
  if (!user) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(app)/classrooms" />;
}
