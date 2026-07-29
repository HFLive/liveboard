"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  apiResourceUrl,
  getPublicSettings,
  type SystemSettings,
} from "@/lib/api";
import { setAppTimeZone } from "@/lib/labels";

let currentIconSettings: AppIconSettings = {
  faviconUrl: null,
  faviconLightUrl: null,
  faviconDarkUrl: null,
};
const DEFAULT_FAVICON_PATH = "/favicon.ico?v=liveboard-default-1";

type AppIconSettings = Pick<
  SystemSettings,
  "faviconUrl" | "faviconLightUrl" | "faviconDarkUrl"
>;

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
        setAppIconSettings(result.settings);
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
    applyAppIconSettings();
  }, [pathname]);

  return <>{children}</>;
}

export function setAppFavicon(path: string | null) {
  currentIconSettings = { ...currentIconSettings, faviconUrl: path };
  applyAppIconSettings();
}

export function setAppIconSettings(settings: AppIconSettings) {
  currentIconSettings = {
    faviconUrl: settings.faviconUrl,
    faviconLightUrl: settings.faviconLightUrl,
    faviconDarkUrl: settings.faviconDarkUrl,
  };
  applyAppIconSettings();
}

function applyAppIconSettings() {
  const defaultUrl = currentIconSettings.faviconUrl
    ? apiResourceUrl(currentIconSettings.faviconUrl)
    : DEFAULT_FAVICON_PATH;
  const lightUrl = currentIconSettings.faviconLightUrl
    ? apiResourceUrl(currentIconSettings.faviconLightUrl)
    : null;
  const darkUrl = currentIconSettings.faviconDarkUrl
    ? apiResourceUrl(currentIconSettings.faviconDarkUrl)
    : null;

  document.head
    .querySelectorAll<HTMLLinkElement>("link[rel~='icon']")
    .forEach((candidate) => candidate.remove());

  appendFaviconLink("default", defaultUrl);
  if (lightUrl) {
    appendFaviconLink("light", lightUrl, "(prefers-color-scheme: light)");
  }
  if (darkUrl) {
    appendFaviconLink("dark", darkUrl, "(prefers-color-scheme: dark)");
  }

  setBrandIconVariable(
    "light",
    lightUrl ?? (currentIconSettings.faviconUrl ? defaultUrl : null),
  );
  setBrandIconVariable(
    "dark",
    darkUrl ?? (currentIconSettings.faviconUrl ? defaultUrl : null),
  );
}

function appendFaviconLink(
  variant: "default" | "light" | "dark",
  href: string,
  media?: string,
) {
  const link = document.createElement("link");
  link.rel = "icon";
  link.dataset.liveboardFavicon = "true";
  link.dataset.liveboardFaviconVariant = variant;
  link.href = href;
  if (media) link.media = media;
  document.head.appendChild(link);
}

function setBrandIconVariable(tone: "light" | "dark", url: string | null) {
  const root = document.documentElement;
  const attribute = `data-site-brand-icon-${tone}`;
  const property = `--site-brand-icon-${tone}`;
  if (url) {
    root.setAttribute(attribute, "true");
    root.style.setProperty(property, `url(${JSON.stringify(url)})`);
    return;
  }

  root.removeAttribute(attribute);
  root.style.removeProperty(property);
}

export function resetAppIconSettingsForTest() {
  currentIconSettings = {
    faviconUrl: null,
    faviconLightUrl: null,
    faviconDarkUrl: null,
  };
  document.head
    .querySelectorAll<HTMLLinkElement>("link[data-liveboard-favicon='true']")
    .forEach((candidate) => candidate.remove());
  setBrandIconVariable("light", null);
  setBrandIconVariable("dark", null);
}
