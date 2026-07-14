import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const PREFIX = "enc:v1";

@Injectable()
export class AiSecretService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const configured = config.get<string>("AI_ENCRYPTION_KEY")?.trim();
    const fallback = config.get<string>(
      "SESSION_SECRET",
      "liveboard-dev-ai-encryption-key",
    );
    if (
      process.env.NODE_ENV === "production" &&
      (!configured || configured.startsWith("replace-with-"))
    ) {
      throw new Error("AI_ENCRYPTION_KEY must be configured in production");
    }
    this.key = createHash("sha256")
      .update(configured || fallback)
      .digest();
  }

  encrypt(value: string) {
    const plaintext = this.decrypt(value);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [PREFIX, iv, tag, encrypted]
      .map((part) =>
        typeof part === "string" ? part : part.toString("base64url"),
      )
      .join(":");
  }

  decrypt(value: string) {
    if (!this.isEncrypted(value)) return value;
    const parts = value.split(":");
    if (parts.length !== 5) {
      throw new Error("Unable to decrypt stored AI API key");
    }
    const ivValue = parts[2]!;
    const tagValue = parts[3]!;
    const encryptedValue = parts[4]!;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(ivValue, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("Unable to decrypt stored AI API key");
    }
  }

  isEncrypted(value: string) {
    return value.startsWith(`${PREFIX}:`);
  }
}
