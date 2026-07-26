import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createConnection } from "node:net";

export interface HttpsStatus {
  available: boolean;
  enabled: boolean;
  domain: string | null;
  subjectType: "domain" | "ip" | null;
  challengeType: "http-01" | "tls-alpn-01" | null;
  certificateProfile: "shortlived" | null;
  autoRenewEnabled: boolean;
  httpHost: string | null;
  expiresAt: string | null;
  lastRenewedAt: string | null;
  lastRenewalCheckAt: string | null;
  lastError: string | null;
}

interface AgentResponse {
  ok: boolean;
  status?: HttpsStatus;
  message?: string;
}

@Injectable()
export class HttpsAgentClient {
  private readonly socketPath: string;

  constructor(config: ConfigService) {
    this.socketPath = config.get<string>(
      "LIVEBOARD_HTTPS_SOCKET",
      "/run/liveboard/https-agent.sock",
    );
  }

  async status(): Promise<HttpsStatus> {
    try {
      return await this.request({ action: "status" }, 3_000);
    } catch (caught) {
      if (isUnavailableSocketError(caught)) {
        return unavailableStatus;
      }
      throw caught;
    }
  }

  async enable(domain: string, email: string): Promise<HttpsStatus> {
    try {
      return await this.request({ action: "enable", domain, email }, 420_000);
    } catch (caught) {
      if (isUnavailableSocketError(caught)) {
        throw new ServiceUnavailableException(
          "当前服务器未安装 HTTPS 助手，请先升级生产部署包",
        );
      }
      throw caught;
    }
  }

  async disable(httpHost: string): Promise<HttpsStatus> {
    try {
      return await this.request({ action: "disable", httpHost }, 180_000);
    } catch (caught) {
      if (isUnavailableSocketError(caught)) {
        throw new ServiceUnavailableException(
          "当前服务器未安装 HTTPS 助手，请先升级生产部署包",
        );
      }
      throw caught;
    }
  }

  async setAutoRenew(enabled: boolean): Promise<HttpsStatus> {
    try {
      return await this.request({ action: "set-auto-renew", enabled }, 30_000);
    } catch (caught) {
      if (isUnavailableSocketError(caught)) {
        throw new ServiceUnavailableException(
          "当前服务器未安装 HTTPS 助手，请先升级生产部署包",
        );
      }
      throw caught;
    }
  }

  private request(
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<HttpsStatus> {
    return new Promise((resolve, reject) => {
      const connection = createConnection(this.socketPath);
      let response = "";
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        connection.destroy();
      };
      const finishResolve = (value: HttpsStatus) => {
        if (settled) return;
        finish();
        resolve(value);
      };
      const finishReject = (error: Error) => {
        if (settled) return;
        finish();
        reject(error);
      };

      connection.setEncoding("utf8");
      connection.setTimeout(timeoutMs);
      connection.on("connect", () => {
        connection.write(`${JSON.stringify(payload)}\n`);
      });
      connection.on("data", (chunk: string) => {
        response += chunk;
        if (response.length > 32_768) {
          finishReject(new Error("HTTPS 助手响应过大"));
          return;
        }
        const newline = response.indexOf("\n");
        if (newline === -1) return;
        try {
          const parsed = JSON.parse(
            response.slice(0, newline),
          ) as AgentResponse;
          if (!parsed.ok || !parsed.status) {
            finishReject(
              new ServiceUnavailableException(
                parsed.message ?? "HTTPS 配置失败",
              ),
            );
            return;
          }
          finishResolve(parsed.status);
        } catch {
          finishReject(new Error("HTTPS 助手返回了无效响应"));
        }
      });
      connection.on("timeout", () => {
        finishReject(new Error("HTTPS 配置操作超时"));
      });
      connection.on("error", (error) => {
        finishReject(error);
      });
      connection.on("end", () => {
        if (!settled) {
          finishReject(new Error("HTTPS 助手提前关闭了连接"));
        }
      });
    });
  }
}

const unavailableStatus: HttpsStatus = {
  available: false,
  enabled: false,
  domain: null,
  subjectType: null,
  challengeType: null,
  certificateProfile: null,
  autoRenewEnabled: false,
  httpHost: null,
  expiresAt: null,
  lastRenewedAt: null,
  lastRenewalCheckAt: null,
  lastError: null,
};

function isUnavailableSocketError(caught: unknown) {
  if (!(caught instanceof Error)) return false;
  const code = (caught as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ECONNREFUSED" || code === "EACCES";
}
