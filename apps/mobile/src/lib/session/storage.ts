import * as SecureStore from "expo-secure-store";

const SERVER_URL_KEY = "liveboard.serverUrl";
const SESSION_TOKEN_KEY = "liveboard.sessionToken";

export async function readStoredServerUrl() {
  return SecureStore.getItemAsync(SERVER_URL_KEY);
}

export async function writeStoredServerUrl(url: string) {
  await SecureStore.setItemAsync(SERVER_URL_KEY, url);
}

export async function readStoredSessionToken() {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

export async function writeStoredSessionToken(token: string) {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

export async function clearStoredSession() {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}

export async function clearStoredServer() {
  await SecureStore.deleteItemAsync(SERVER_URL_KEY);
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}
