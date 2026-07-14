export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function shouldRedirectToLogin(status: number, path: string) {
  return status === 401 && path !== "/auth/login";
}

export function redirectToLoginOnUnauthorized(status: number, path: string) {
  if (shouldRedirectToLogin(status, path) && typeof window !== "undefined") {
    window.location.replace("/login?reason=session-expired");
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join("；")
      : body?.message;

    redirectToLoginOnUnauthorized(response.status, path);

    throw new ApiError(message ?? "Request failed", response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
