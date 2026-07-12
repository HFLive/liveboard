"use client";

import { useEffect } from "react";

const reloadPrefix = "liveboard:chunk-reload";

function messageFrom(reason: unknown) {
  if (!reason) {
    return "";
  }

  if (typeof reason === "string") {
    return reason;
  }

  if (reason instanceof Error) {
    return `${reason.name} ${reason.message}`;
  }

  if (typeof reason === "object" && "message" in reason) {
    const message = (reason as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }

  return "";
}

function isChunkLoadFailure(reason: unknown) {
  return /Loading chunk .* failed|ChunkLoadError|CSS_CHUNK_LOAD_FAILED|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    messageFrom(reason),
  );
}

function reloadOnce() {
  const key = `${reloadPrefix}:${window.location.pathname}`;

  try {
    if (window.sessionStorage.getItem(key) === "1") {
      return;
    }

    window.sessionStorage.setItem(key, "1");
  } catch {
    return;
  }

  window.location.reload();
}

export function ChunkLoadRecovery() {
  useEffect(() => {
    function onError(event: Event) {
      const target = event.target;

      if (
        target instanceof HTMLScriptElement &&
        target.src.includes("/_next/static/chunks/")
      ) {
        reloadOnce();
        return;
      }

      const errorEvent = event as ErrorEvent;
      if (
        isChunkLoadFailure(errorEvent.error) ||
        isChunkLoadFailure(errorEvent.message)
      ) {
        reloadOnce();
      }
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadFailure(event.reason)) {
        reloadOnce();
      }
    }

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
