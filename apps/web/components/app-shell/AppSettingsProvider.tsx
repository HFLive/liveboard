"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, type ReactNode } from "react";
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
let iconSettingsResolved = false;
let defaultFaviconResetRequired = false;
const DEFAULT_FAVICON_PATH = "/favicon.ico?v=liveboard-default-1";
const ICON_SETTINGS_CACHE_KEY = "liveboard:site-icon-settings:v1";

type AppIconSettings = Pick<
  SystemSettings,
  "faviconUrl" | "faviconLightUrl" | "faviconDarkUrl"
>;

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useLayoutEffect(() => {
    const cachedSettings = readCachedAppIconSettings();
    if (cachedSettings) {
      applyResolvedAppIconSettings(cachedSettings);
    }
  }, []);

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
    // 首次公开配置还未返回时不额外请求空的默认 favicon。
    if (iconSettingsResolved) applyAppIconSettings();
  }, [pathname]);

  return <>{children}</>;
}

export function setAppFavicon(path: string | null) {
  applyResolvedAppIconSettings({
    ...currentIconSettings,
    faviconUrl: path,
  });
}

export function setAppIconSettings(settings: AppIconSettings) {
  applyResolvedAppIconSettings(settings);
}

function applyResolvedAppIconSettings(settings: AppIconSettings) {
  iconSettingsResolved = true;
  if (settings.faviconUrl) {
    defaultFaviconResetRequired = false;
  } else if (currentIconSettings.faviconUrl) {
    // 仅在当前页曾显示过自定义图标时请求 204 默认路由，
    // 用来立即清除标签页上的旧图标。首次加载无自定义图标时不重复请求。
    defaultFaviconResetRequired = true;
  }
  currentIconSettings = {
    faviconUrl: settings.faviconUrl,
    faviconLightUrl: settings.faviconLightUrl,
    faviconDarkUrl: settings.faviconDarkUrl,
  };
  cacheAppIconSettings(currentIconSettings);
  applyAppIconSettings();
}

function applyAppIconSettings() {
  const defaultUrl = currentIconSettings.faviconUrl
    ? apiResourceUrl(currentIconSettings.faviconUrl)
    : defaultFaviconResetRequired
      ? DEFAULT_FAVICON_PATH
      : null;
  const lightUrl = currentIconSettings.faviconLightUrl
    ? apiResourceUrl(currentIconSettings.faviconLightUrl)
    : null;
  const darkUrl = currentIconSettings.faviconDarkUrl
    ? apiResourceUrl(currentIconSettings.faviconDarkUrl)
    : null;

  reconcileFaviconLinks([
    ...(defaultUrl ? [{ variant: "default", href: defaultUrl } as const] : []),
    ...(lightUrl
      ? ([
          {
            variant: "light",
            href: lightUrl,
            media: "(prefers-color-scheme: light)",
          },
        ] as const)
      : []),
    ...(darkUrl
      ? ([
          {
            variant: "dark",
            href: darkUrl,
            media: "(prefers-color-scheme: dark)",
          },
        ] as const)
      : []),
  ]);

  setBrandIconVariable(
    "light",
    lightUrl ?? (currentIconSettings.faviconUrl ? defaultUrl : null),
  );
  setBrandIconVariable(
    "dark",
    darkUrl ?? (currentIconSettings.faviconUrl ? defaultUrl : null),
  );
  document.documentElement.toggleAttribute(
    "data-site-brand-icons-ready",
    iconSettingsResolved,
  );
}

type DesiredFaviconLink = {
  variant: "default" | "light" | "dark";
  href: string;
  media?: string;
};

/**
 * Next.js 路由元数据可能会改写 head，所以不能只在首次挂载时设置。
 * 同时，直接删除再插入相同 link 会让浏览器重新请求图标。
 * 这里保留已符合期望的 DOM 节点，只更新真正变化的变体。
 */
function reconcileFaviconLinks(desiredLinks: DesiredFaviconLink[]) {
  const candidates = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"),
  );
  const retained = new Set<HTMLLinkElement>();

  for (const desired of desiredLinks) {
    const desiredHref = new URL(desired.href, document.baseURI).href;
    const desiredMedia = desired.media ?? "";
    const candidate =
      candidates.find(
        (link) =>
          !retained.has(link) &&
          link.dataset.liveboardFaviconVariant === desired.variant,
      ) ??
      candidates.find(
        (link) =>
          !retained.has(link) &&
          link.href === desiredHref &&
          link.media === desiredMedia,
      );

    if (!candidate) {
      retained.add(
        appendFaviconLink(desired.variant, desired.href, desired.media),
      );
      continue;
    }

    retained.add(candidate);
    candidate.dataset.liveboardFavicon = "true";
    candidate.dataset.liveboardFaviconVariant = desired.variant;
    if (candidate.href !== desiredHref) candidate.href = desired.href;
    if (candidate.media !== desiredMedia) candidate.media = desiredMedia;
  }

  for (const candidate of candidates) {
    if (!retained.has(candidate)) candidate.remove();
  }
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
  return link;
}

function setBrandIconVariable(tone: "light" | "dark", url: string | null) {
  const root = document.documentElement;
  const attribute = `data-site-brand-icon-${tone}`;
  const property = `--site-brand-icon-${tone}`;
  if (url) {
    if (!root.hasAttribute(attribute)) root.setAttribute(attribute, "true");
    const value = `url(${JSON.stringify(url)})`;
    if (root.style.getPropertyValue(property) !== value) {
      root.style.setProperty(property, value);
    }
    return;
  }

  root.removeAttribute(attribute);
  root.style.removeProperty(property);
}

function cacheAppIconSettings(settings: AppIconSettings) {
  try {
    if (
      !settings.faviconUrl &&
      !settings.faviconLightUrl &&
      !settings.faviconDarkUrl
    ) {
      window.localStorage.removeItem(ICON_SETTINGS_CACHE_KEY);
      return;
    }
    window.localStorage.setItem(
      ICON_SETTINGS_CACHE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // 隐私模式或存储配额限制不应影响图标正常加载。
  }
}

function readCachedAppIconSettings(): AppIconSettings | null {
  try {
    const value = window.localStorage.getItem(ICON_SETTINGS_CACHE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<AppIconSettings>;
    const settings = {
      faviconUrl: validateCachedIconPath(parsed.faviconUrl, "default"),
      faviconLightUrl: validateCachedIconPath(parsed.faviconLightUrl, "light"),
      faviconDarkUrl: validateCachedIconPath(parsed.faviconDarkUrl, "dark"),
    };
    if (
      !settings.faviconUrl &&
      !settings.faviconLightUrl &&
      !settings.faviconDarkUrl
    ) {
      window.localStorage.removeItem(ICON_SETTINGS_CACHE_KEY);
      return null;
    }
    return settings;
  } catch {
    window.localStorage.removeItem(ICON_SETTINGS_CACHE_KEY);
    return null;
  }
}

function validateCachedIconPath(
  value: unknown,
  variant: "default" | "light" | "dark",
) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const suffix = variant === "default" ? "" : `/${variant}`;
  return new RegExp(`^/settings/favicon${suffix}\\?v=\\d+$`).test(value)
    ? value
    : null;
}

export function resetAppIconSettingsForTest() {
  iconSettingsResolved = false;
  defaultFaviconResetRequired = false;
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
  document.documentElement.removeAttribute("data-site-brand-icons-ready");
  window.localStorage.removeItem(ICON_SETTINGS_CACHE_KEY);
}
