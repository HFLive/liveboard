"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { appRouteTitle } from "@/lib/routes";

function setTitleForPath(pathname: string) {
  const title = appRouteTitle(pathname);
  if (title)
    document.title = title === "LiveBoard" ? title : `${title} · LiveBoard`;
}

export function RouteTitleSync() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    setTitleForPath(pathname);
  }, [pathname]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const anchor =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.download ||
        (anchor.target && anchor.target !== "_self")
      ) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin === window.location.origin) {
        setTitleForPath(destination.pathname);
      }
    }

    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, []);

  return null;
}
