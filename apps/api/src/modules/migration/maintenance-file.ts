import { readFile, rename, writeFile } from "node:fs/promises";

/**
 * 维护模式状态文件的读写（纯函数，供 NestJS 的 MaintenanceService 与
 * 命令行迁移脚本共用）。状态存文件而非数据库：导入期间目标库会被整体重建，
 * 开关必须在数据库不可用时仍可读取。
 */

export interface MaintenanceState {
  enabled: boolean;
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const MAINTENANCE_OFF: MaintenanceState = {
  enabled: false,
  reason: null,
  updatedAt: null,
  updatedBy: null,
};

export async function readMaintenanceStateFile(
  file: string,
): Promise<MaintenanceState> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (caught) {
    // 文件不存在视为从未开启；其它读错误（权限/损坏/并发写坏）向上抛，由调用方
    // 决定 fail-closed（维护模式按开启处理），绝不静默当作"关闭"放行写请求。
    if ((caught as { code?: unknown }).code === "ENOENT") return MAINTENANCE_OFF;
    throw caught;
  }
  const parsed = JSON.parse(raw) as Partial<MaintenanceState>;
  return {
    enabled: parsed.enabled === true,
    reason: typeof parsed.reason === "string" ? parsed.reason : null,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : null,
  };
}

export async function writeMaintenanceStateFile(
  file: string,
  state: MaintenanceState,
): Promise<void> {
  // 唯一临时名（含 pid+随机），避免跨进程交错写同一 .tmp 互相覆盖损坏文件；
  // rename 仍原子，last-writer-wins。
  const temporary = `${file}.${process.pid}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}
