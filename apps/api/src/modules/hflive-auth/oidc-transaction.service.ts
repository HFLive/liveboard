import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, randomBytes } from "node:crypto";
import { RedisService } from "../redis/redis.service";

export type OidcIntent = "LOGIN" | "LOCAL_SESSION";

export interface OidcTransaction {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  intent: OidcIntent;
  userId?: string;
  createdAt: string;
}

export interface ConflictTicket {
  issuer: string;
  subject: string;
  preferredUsername: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  picture: string | null;
  directoryUpdatedAt: string;
}

const OIDC_TTL_SECONDS = 10 * 60;

@Injectable()
export class OidcTransactionService {
  constructor(private readonly redis: RedisService) {}

  newOpaqueValue() {
    return randomBytes(32).toString("base64url");
  }

  normalizeReturnTo(value?: string) {
    if (!value) return "/app";
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      throw new UnauthorizedException("Invalid return path");
    }
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      decoded.startsWith("//") ||
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      decoded.includes("\r") ||
      decoded.includes("\n")
    ) {
      throw new UnauthorizedException("Invalid return path");
    }
    return value;
  }

  async storeOidc(state: string, value: OidcTransaction) {
    const client = await this.requireRedis();
    await client.set(this.key("oidc", state), JSON.stringify(value), {
      expiration: { type: "EX", value: OIDC_TTL_SECONDS },
    });
  }

  async consumeOidc(state: string): Promise<OidcTransaction> {
    const client = await this.requireRedis();
    const raw = await client.getDel(this.key("oidc", state));
    if (!raw) throw new UnauthorizedException("Invalid or expired OIDC state");
    try {
      return JSON.parse(raw) as OidcTransaction;
    } catch {
      throw new UnauthorizedException("Invalid or expired OIDC state");
    }
  }

  async createConflict(value: ConflictTicket) {
    const ticket = this.newOpaqueValue();
    const client = await this.requireRedis();
    await client.set(this.key("conflict", ticket), JSON.stringify(value), {
      expiration: { type: "EX", value: OIDC_TTL_SECONDS },
    });
    return ticket;
  }

  async consumeConflict(ticket: string): Promise<ConflictTicket> {
    const client = await this.requireRedis();
    const raw = await client.getDel(this.key("conflict", ticket));
    if (!raw) throw new UnauthorizedException("Invalid or expired link ticket");
    try {
      return JSON.parse(raw) as ConflictTicket;
    } catch {
      throw new UnauthorizedException("Invalid or expired link ticket");
    }
  }

  private async requireRedis() {
    const client = await this.redis.getClient();
    if (!client) {
      throw new ServiceUnavailableException(
        "OIDC requires persistent Redis storage",
      );
    }
    return client;
  }

  private key(purpose: string, value: string) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET is required for OIDC state");
    const digest = createHmac("sha256", secret)
      .update(`hflive:${purpose}:${value}`)
      .digest("base64url");
    return `liveboard:hflive:${purpose}:${digest}`;
  }
}
