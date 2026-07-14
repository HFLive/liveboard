import { ConfigService } from "@nestjs/config";
import { AiSecretService } from "./ai-secret.service";

describe("AiSecretService", () => {
  function createService(key = "test-encryption-key") {
    return new AiSecretService(
      new ConfigService({
        AI_ENCRYPTION_KEY: key,
        SESSION_SECRET: "test-session-secret",
      }),
    );
  }

  it("encrypts and decrypts API keys", () => {
    const service = createService();
    const encrypted = service.encrypt("sk-private");

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("sk-private");
    expect(service.decrypt(encrypted)).toBe("sk-private");
  });

  it("uses a fresh IV for every stored value", () => {
    const service = createService();

    expect(service.encrypt("sk-private")).not.toBe(
      service.encrypt("sk-private"),
    );
  });

  it("keeps legacy plaintext readable for lazy migration", () => {
    expect(createService().decrypt("legacy-key")).toBe("legacy-key");
  });

  it("fails closed when ciphertext is opened with a different key", () => {
    const encrypted = createService("first-key").encrypt("sk-private");

    expect(() => createService("second-key").decrypt(encrypted)).toThrow(
      "Unable to decrypt stored AI API key",
    );
  });
});
