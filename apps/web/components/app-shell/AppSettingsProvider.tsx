"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { apiResourceUrl, getPublicSettings } from "@/lib/api";
import { setAppTimeZone } from "@/lib/labels";

let currentFaviconPath: string | null = null;
const DEFAULT_FAVICON_PATH = "/favicon.ico?v=liveboard-default-1";

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    let active = true;

    getPublicSettings()
      .then((result) => {
        if (!active) {
          return;
        }

        setAppTimeZone(result.settings.timeZone);
        setAppFavicon(result.settings.faviconUrl);
      })
      .catch(() => {
        // Keep the default/client-cached timezone if public settings cannot load.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Next.js 会在路由切换时同步页面 head。每次切换后重新应用工作区图标，
    // 避免运行时插入的 favicon 被路由元数据清理，导致各页面图标不一致。
    setAppFavicon(currentFaviconPath);
  }, [pathname]);

  return <>{children}</>;
}

export function setAppFavicon(path: string | null) {
  currentFaviconPath = path;
  const selector = "link[data-liveboard-favicon='true']";
  const existing = document.head.querySelector<HTMLLinkElement>(selector);
  const link = existing ?? document.createElement("link");
  link.rel = "icon";
  link.dataset.liveboardFavicon = "true";
  link.href = path ? apiResourceUrl(path) : DEFAULT_FAVICON_PATH;

  document.head
    .querySelectorAll<HTMLLinkElement>("link[rel~='icon']")
    .forEach((candidate) => {
      if (candidate !== link) {
        candidate.remove();
      }
    });

  if (!existing) {
    document.head.appendChild(link);
  }
}
