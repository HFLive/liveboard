"use client";

import { useEffect, type ReactNode } from "react";
import { getPublicSettings } from "@/lib/api";
import { setAppTimeZone } from "@/lib/labels";

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let active = true;

    getPublicSettings()
      .then((result) => {
        if (!active) {
          return;
        }

        setAppTimeZone(result.settings.timeZone);
      })
      .catch(() => {
        // Keep the default/client-cached timezone if public settings cannot load.
      });

    return () => {
      active = false;
    };
  }, []);

  return <>{children}</>;
}
