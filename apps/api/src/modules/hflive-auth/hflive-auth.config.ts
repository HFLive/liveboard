import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export const HFLIVE_ISSUER = "https://auth.hsfz.live";
export const HFLIVE_PROFILE_URL = `${HFLIVE_ISSUER}/profile`;
export type AuthMode = "local" | "hybrid" | "hflive_oidc";

@Injectable()
export class HfliveAuthConfig {
  constructor(private readonly config: ConfigService) {}

  get mode(): AuthMode {
    const value = this.config.get<string>("AUTH_MODE", "local").trim();
    if (value === "local" || value === "hybrid" || value === "hflive_oidc") {
      return value;
    }
    return "local";
  }

  get issuer() {
    return this.config.get<string>("HFLIVE_OIDC_ISSUER", HFLIVE_ISSUER).trim();
  }

  get oidcClientId() {
    return this.config.get<string>("HFLIVE_OIDC_CLIENT_ID", "").trim();
  }

  get oidcClientSecret() {
    return this.config.get<string>("HFLIVE_OIDC_CLIENT_SECRET", "");
  }

  get redirectUri() {
    return this.config.get<string>("HFLIVE_OIDC_REDIRECT_URI", "").trim();
  }

  get directoryClientId() {
    return this.config.get<string>("HFLIVE_DIRECTORY_CLIENT_ID", "").trim();
  }

  get directoryClientSecret() {
    return this.config.get<string>("HFLIVE_DIRECTORY_CLIENT_SECRET", "");
  }

  get webhookSecret() {
    return this.config.get<string>("HFLIVE_WEBHOOK_SECRET", "");
  }

  get previousWebhookSecret() {
    return this.config.get<string>("HFLIVE_WEBHOOK_PREVIOUS_SECRET", "");
  }

  get breakglassEnabled() {
    return (
      this.config.get<string>("HFLIVE_BREAKGLASS_ENABLED", "false") === "true"
    );
  }

  get enabled() {
    return this.mode !== "local";
  }

  get profileUrl() {
    if (!this.enabled || !this.redirectUri) return HFLIVE_PROFILE_URL;
    try {
      const applicationOrigin = new URL(this.redirectUri).origin;
      const target = new URL(HFLIVE_PROFILE_URL);
      target.searchParams.set("returnTo", `${applicationOrigin}/app/profile`);
      return target.toString();
    } catch {
      return HFLIVE_PROFILE_URL;
    }
  }

  publicCapabilities() {
    return {
      mode: this.mode,
      localLogin: this.mode !== "hflive_oidc",
      hfliveOidc: this.enabled,
      breakglass: this.mode === "hflive_oidc" && this.breakglassEnabled,
      issuer: HFLIVE_ISSUER,
      profileUrl: this.profileUrl,
    };
  }

  validationErrors() {
    const errors: string[] = [];
    const configuredMode = this.config.get<string>("AUTH_MODE", "local").trim();
    if (!["local", "hybrid", "hflive_oidc"].includes(configuredMode)) {
      errors.push("AUTH_MODE");
    }
    if (!this.enabled) return errors;
    if (this.issuer !== HFLIVE_ISSUER) errors.push("HFLIVE_OIDC_ISSUER");
    if (!this.oidcClientId) errors.push("HFLIVE_OIDC_CLIENT_ID");
    if (!this.oidcClientSecret) errors.push("HFLIVE_OIDC_CLIENT_SECRET");
    if (!this.redirectUri) errors.push("HFLIVE_OIDC_REDIRECT_URI");
    else {
      try {
        const redirect = new URL(this.redirectUri);
        if (
          redirect.protocol !== "https:" &&
          redirect.hostname !== "localhost"
        ) {
          errors.push("HFLIVE_OIDC_REDIRECT_URI");
        }
      } catch {
        errors.push("HFLIVE_OIDC_REDIRECT_URI");
      }
    }
    if (!this.directoryClientId) errors.push("HFLIVE_DIRECTORY_CLIENT_ID");
    if (!this.directoryClientSecret)
      errors.push("HFLIVE_DIRECTORY_CLIENT_SECRET");
    if (!this.webhookSecret) errors.push("HFLIVE_WEBHOOK_SECRET");
    return [...new Set(errors)];
  }
}
