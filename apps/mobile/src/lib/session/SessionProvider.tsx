import type { AuthCapabilities, UserProfile } from "@liveboard/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  breakglassLogin,
  configureApiClient,
  getAuthCapabilities,
  getMe,
  login as requestLogin,
  logout as requestLogout,
  setApiUnauthorizedHandler,
} from "../api";
import { defaultServerUrl, normalizeServerUrl } from "../server-url";
import {
  clearStoredSession,
  readStoredServerUrl,
  readStoredSessionToken,
  writeStoredServerUrl,
  writeStoredSessionToken,
} from "./storage";

interface Notice {
  id: number;
  text: string;
  tone: "success" | "error";
}

interface SessionValue {
  ready: boolean;
  serverUrl: string | null;
  user: UserProfile | null;
  capabilities: AuthCapabilities | null;
  notice: Notice | null;
  setServerUrl: (value: string) => Promise<AuthCapabilities>;
  login: (
    username: string,
    password: string,
    emergency?: boolean,
  ) => Promise<void>;
  logout: () => Promise<void>;
  notify: (text: string, tone?: Notice["tone"]) => void;
  clearNotice: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);

  const notify = useCallback((text: string, tone: Notice["tone"] = "error") => {
    setNotice({ id: Date.now(), text, tone });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    setApiUnauthorizedHandler(() => {
      setUser(null);
      configureApiClient({
        baseUrl: serverUrl ?? defaultServerUrl(),
        sessionToken: null,
      });
      void clearStoredSession();
    });
    return () => setApiUnauthorizedHandler(null);
  }, [serverUrl]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storedUrl = await readStoredServerUrl();
      const token = await readStoredSessionToken();
      try {
        const normalized = storedUrl
          ? normalizeServerUrl(storedUrl)
          : defaultServerUrl();
        configureApiClient({ baseUrl: normalized, sessionToken: token });
        if (!cancelled) {
          setServerUrlState(storedUrl ? normalized : null);
        }
        if (storedUrl) {
          const caps = await getAuthCapabilities().catch(() => null);
          if (!cancelled) setCapabilities(caps);
        }
        if (token) {
          const result = await getMe();
          if (!cancelled) setUser(result.user);
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          await clearStoredSession();
        }
        if (!cancelled && !storedUrl) {
          setServerUrlState(null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setServerUrl = useCallback(async (value: string) => {
    const normalized = normalizeServerUrl(value);
    configureApiClient({ baseUrl: normalized, sessionToken: null });
    const caps = await getAuthCapabilities();
    await writeStoredServerUrl(normalized);
    await clearStoredSession();
    setServerUrlState(normalized);
    setCapabilities(caps);
    setUser(null);
    return caps;
  }, []);

  const login = useCallback(
    async (username: string, password: string, emergency = false) => {
      const result = emergency
        ? await breakglassLogin(username, password)
        : await requestLogin(username, password);
      if (!result.sessionToken) {
        throw new Error("服务器未返回移动端会话，请升级 API 后重试");
      }
      const baseUrl = serverUrl ?? defaultServerUrl();
      configureApiClient({
        baseUrl,
        sessionToken: result.sessionToken,
      });
      await writeStoredSessionToken(result.sessionToken);
      const me = await getMe();
      setUser(me.user);
    },
    [serverUrl],
  );

  const logout = useCallback(async () => {
    try {
      await requestLogout();
    } catch {
      // 本地清会话即可。
    }
    await clearStoredSession();
    configureApiClient({
      baseUrl: serverUrl ?? defaultServerUrl(),
      sessionToken: null,
    });
    setUser(null);
  }, [serverUrl]);

  const value = useMemo(
    () => ({
      ready,
      serverUrl,
      user,
      capabilities,
      notice,
      setServerUrl,
      login,
      logout,
      notify,
      clearNotice,
    }),
    [
      ready,
      serverUrl,
      user,
      capabilities,
      notice,
      setServerUrl,
      login,
      logout,
      notify,
      clearNotice,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return value;
}
