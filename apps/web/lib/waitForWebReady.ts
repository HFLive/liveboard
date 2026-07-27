type WaitForWebReadyOptions = {
  initialDelayMs?: number;
  minimumWaitMs?: number;
  probeTimeoutMs?: number;
  requiredSuccesses?: number;
  retryIntervalMs?: number;
  timeoutMs?: number;
};

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function probeReadinessImage(url: string, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(ready);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

export async function waitForWebReady(
  origin: string,
  {
    initialDelayMs = 500,
    minimumWaitMs = 15_000,
    probeTimeoutMs = 3_000,
    requiredSuccesses = 2,
    retryIntervalMs = 1_000,
    timeoutMs = 180_000,
  }: WaitForWebReadyOptions = {},
) {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let attempt = 0;
  let consecutiveSuccesses = 0;
  let observedInterruption = false;

  if (initialDelayMs > 0) {
    await delay(initialDelayMs);
  }

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const probeUrl =
      `${normalizedOrigin}/liveboard-readiness.svg` +
      `?attempt=${attempt}&time=${Date.now()}`;
    const ready = await probeReadinessImage(
      probeUrl,
      Math.max(1, Math.min(probeTimeoutMs, remaining)),
    );
    if (ready) {
      consecutiveSuccesses += 1;
      const minimumWaitElapsed = Date.now() - startedAt >= minimumWaitMs;
      if (
        consecutiveSuccesses >= requiredSuccesses &&
        (observedInterruption || minimumWaitElapsed)
      ) {
        return true;
      }
    } else {
      observedInterruption = true;
      consecutiveSuccesses = 0;
    }

    attempt += 1;
    const retryDelay = Math.min(retryIntervalMs, deadline - Date.now());
    if (retryDelay > 0) {
      await delay(retryDelay);
    }
  }

  return false;
}
