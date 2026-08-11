import type { ConfigService } from "@nestjs/config";
import { HFLIVE_ISSUER, HfliveAuthConfig } from "./hflive-auth.config";

describe("HfliveAuthConfig", () => {
  function config(values: Record<string, string>) {
    return new HfliveAuthConfig({
      get: (key: string, fallback?: string) => values[key] ?? fallback,
    } as ConfigService);
  }

  it("keeps self-hosted installations local without HFLive secrets", () => {
    const subject = config({ AUTH_MODE: "local" });
    expect(subject.publicCapabilities()).toEqual({
      mode: "local",
      localLogin: true,
      hfliveOidc: false,
      breakglass: false,
      issuer: "https://auth.hsfz.live",
      profileUrl: "https://auth.hsfz.live/profile",
    });
    expect(subject.validationErrors()).toEqual([]);
  });

  it("fails readiness for an enabled mode with incomplete or changed issuer config", () => {
    const subject = config({
      AUTH_MODE: "hybrid",
      HFLIVE_OIDC_ISSUER: "https://other.example",
    });
    expect(subject.validationErrors()).toEqual(
      expect.arrayContaining([
        "HFLIVE_OIDC_ISSUER",
        "HFLIVE_OIDC_CLIENT_ID",
        "HFLIVE_OIDC_CLIENT_SECRET",
        "HFLIVE_OIDC_REDIRECT_URI",
        "HFLIVE_DIRECTORY_CLIENT_ID",
        "HFLIVE_DIRECTORY_CLIENT_SECRET",
        "HFLIVE_WEBHOOK_SECRET",
      ]),
    );
  });

  it("accepts the fixed issuer and complete server-only configuration", () => {
    const subject = config({
      AUTH_MODE: "hflive_oidc",
      HFLIVE_OIDC_ISSUER: HFLIVE_ISSUER,
      HFLIVE_OIDC_CLIENT_ID: "login-client",
      HFLIVE_OIDC_CLIENT_SECRET: "secret",
      HFLIVE_OIDC_REDIRECT_URI:
        "https://board.example/api/auth/hflive/callback",
      HFLIVE_DIRECTORY_CLIENT_ID: "directory-client",
      HFLIVE_DIRECTORY_CLIENT_SECRET: "secret",
      HFLIVE_WEBHOOK_SECRET: "webhook",
      HFLIVE_BREAKGLASS_ENABLED: "true",
    });
    expect(subject.validationErrors()).toEqual([]);
    expect(subject.publicCapabilities()).toMatchObject({
      localLogin: false,
      hfliveOidc: true,
      breakglass: true,
      profileUrl:
        "https://auth.hsfz.live/profile?returnTo=https%3A%2F%2Fboard.example%2Fapp%2Fprofile",
    });
  });
});
