"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getMe } from "@/lib/api";

interface UserPreferences {
  /** 打开文档时是否始终使用当前标签页（而非新标签页）。 */
  openContentInCurrentTab: boolean;
}

const UserPreferencesContext = createContext<UserPreferences>({
  openContentInCurrentTab: false,
});

/**
 * 全局用户偏好。挂载在 app 布局中，getMe() 拉取一次后监听
 * `liveboard:profile-updated` 事件刷新（个人设置保存后会派发）。
 * 未登录 / 加载失败时保持默认值（新标签页）。
 */
export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const [openContentInCurrentTab, setOpenContentInCurrentTab] = useState(false);

  useEffect(() => {
    let active = true;

    function load() {
      getMe()
        .then((result) => {
          if (active) {
            setOpenContentInCurrentTab(result.user.openContentInCurrentTab);
          }
        })
        .catch(() => {
          // 保持默认值，不阻断页面渲染。
        });
    }

    load();
    window.addEventListener("liveboard:profile-updated", load);

    return () => {
      active = false;
      window.removeEventListener("liveboard:profile-updated", load);
    };
  }, []);

  return (
    <UserPreferencesContext.Provider value={{ openContentInCurrentTab }}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useContentOpenMode(): boolean {
  return useContext(UserPreferencesContext).openContentInCurrentTab;
}
