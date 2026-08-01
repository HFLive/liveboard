import { ConfigService } from "@nestjs/config";

/**
 * LiveBoard 的两种受支持部署目标：
 * - `self_hosted`：Docker Compose / MinIO / 阿里云 OSS / `.run` Release 部署。
 * - `vercel`：Vercel Hobby 部署，PostgreSQL/Redis 托管，对象存储固定 R2。
 *
 * 业务模块不允许各自读取 `VERCEL` 环境变量决定行为；`VERCEL` 只能作为诊断
 * 信息，明确行为统一以 `DEPLOYMENT_TARGET` 为准。
 */
export type DeploymentTarget = "self_hosted" | "vercel";

const VALID_TARGETS: readonly DeploymentTarget[] = ["self_hosted", "vercel"];

/**
 * 解析 `DEPLOYMENT_TARGET` 环境变量。缺失或为空时返回 `self_hosted`，
 * 保持与既有自托管部署完全兼容；出现未识别的值时启动失败，避免业务模块
 * 在未知模式下做出错误的安全假设。
 */
export function resolveDeploymentTarget(
  value: string | undefined,
): DeploymentTarget {
  const raw = value?.trim().toLowerCase();
  if (!raw || raw === "self_hosted") return "self_hosted";
  if (raw === "vercel") return "vercel";
  throw new Error(
    `Invalid DEPLOYMENT_TARGET "${value}"; expected "self_hosted" or "vercel"`,
  );
}

export function isVercelTarget(value: string | undefined) {
  return resolveDeploymentTarget(value) === "vercel";
}

export function assertValidDeploymentTarget(value: string | undefined) {
  resolveDeploymentTarget(value);
}

export function getDeploymentTarget(config: ConfigService): DeploymentTarget {
  return resolveDeploymentTarget(config.get<string>("DEPLOYMENT_TARGET"));
}
