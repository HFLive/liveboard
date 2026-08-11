import { Injectable } from "@nestjs/common";
import { HFLIVE_ISSUER, HfliveAuthConfig } from "./hflive-auth.config";

export type DirectoryStatus = "ACTIVE" | "DISABLED";

export interface DirectoryProfile {
  subject: string;
  preferredUsername: string;
  name: string;
  picture: string | null;
  email: string | null;
  emailVerified: boolean;
  status: DirectoryStatus;
  updatedAt: string;
}

export class DirectoryRequestError extends Error {
  constructor(
    readonly code:
      "UNAVAILABLE" | "UNAUTHORIZED" | "NOT_FOUND" | "INVALID_RESPONSE",
  ) {
    super(code);
  }
}

@Injectable()
export class HfliveDirectoryService {
  constructor(private readonly config: HfliveAuthConfig) {}

  async getStatus(subject: string) {
    return this.request<{
      subject: string;
      status: DirectoryStatus;
      updatedAt: string;
    }>(subject, "status", "directory:user:status");
  }

  async getProfile(subject: string) {
    return this.request<DirectoryProfile>(
      subject,
      "profile",
      "directory:user:read",
    );
  }

  private async request<T>(
    subject: string,
    kind: "status" | "profile",
    scope: string,
  ) {
    const token = await this.getAccessToken(scope);
    const suffix = kind === "status" ? "/status" : "";
    let response: Response;
    try {
      response = await fetch(
        `${HFLIVE_ISSUER}/api/directory/users/${encodeURIComponent(subject)}${suffix}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
          },
        },
      );
    } catch {
      throw new DirectoryRequestError("UNAVAILABLE");
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new DirectoryRequestError("UNAUTHORIZED");
    }
    if (response.status === 404) {
      await response.body?.cancel();
      throw new DirectoryRequestError("NOT_FOUND");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DirectoryRequestError("UNAVAILABLE");
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new DirectoryRequestError("INVALID_RESPONSE");
    }
  }

  private async getAccessToken(scope: string) {
    const authorization = Buffer.from(
      `${this.config.directoryClientId}:${this.config.directoryClientSecret}`,
    ).toString("base64");
    let response: Response;
    try {
      response = await fetch(`${HFLIVE_ISSUER}/api/auth/oauth2/token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
        headers: {
          authorization: `Basic ${authorization}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope }),
      });
    } catch {
      throw new DirectoryRequestError("UNAVAILABLE");
    }
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      await response.body?.cancel();
      throw new DirectoryRequestError("UNAUTHORIZED");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DirectoryRequestError("UNAVAILABLE");
    }
    const payload = (await response.json().catch(() => null)) as {
      access_token?: unknown;
    } | null;
    if (!payload || typeof payload.access_token !== "string") {
      throw new DirectoryRequestError("INVALID_RESPONSE");
    }
    return payload.access_token;
  }
}
