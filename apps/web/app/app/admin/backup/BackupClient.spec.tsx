import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteBackupJob,
  getBackupInfo,
  listBackupJobs,
  startBackupRestore,
  updateBackupSettings,
  type BackupInfo,
  type BackupJobSummary,
  type BackupSettings,
} from "@/lib/api";
import { BackupClient } from "./BackupClient";

vi.mock("@/lib/api", () => ({
  deleteBackupJob: vi.fn(),
  getBackupInfo: vi.fn(),
  listBackupJobs: vi.fn(),
  startBackupRestore: vi.fn(),
  updateBackupSettings: vi.fn(),
  dismissBackupJobError: vi.fn(),
  startManualBackup: vi.fn(),
}));

vi.mock("@/lib/labels", () => ({
  formatDateTime: vi.fn(() => "2026-01-01"),
}));

vi.mock("@/components/admin/AdminPageHeader", () => ({
  AdminPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const settings: BackupSettings = {
  enabled: true,
  scheduleHour: 3,
  scheduleMinute: 0,
  scheduleWeekday: null,
  autoRetention: 7,
  includeObjects: true,
  lastAutoBackupAt: null,
};

const info: BackupInfo = {
  deploymentTarget: "self_hosted",
  supported: true,
  unavailableReason: null,
  settings,
  confirmPhrase: "CONFIRM-RESTORE",
  defaults: {
    autoRetention: 7,
    schedule: { hour: 3, minute: 0, weekday: null },
  },
};

const succeededBackup: BackupJobSummary = {
  id: "b1",
  kind: "manual",
  status: "succeeded",
  phase: "done",
  progress: null,
  backupPath: "backups/b1",
  restoreFromId: null,
  neonBranchId: null,
  dumpSizeBytes: "1024",
  objectCount: 0,
  includeObjects: false,
  isProtection: false,
  manifest: null,
  error: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const runningRestore: BackupJobSummary = {
  id: "r1",
  kind: "restore",
  status: "running",
  phase: "restore/restore",
  progress: { done: 0, total: 1 },
  backupPath: null,
  restoreFromId: "b1",
  neonBranchId: null,
  dumpSizeBytes: null,
  objectCount: null,
  includeObjects: false,
  isProtection: false,
  manifest: null,
  error: null,
  createdBy: null,
  createdAt: "2026-01-02T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("BackupClient", () => {
  beforeEach(() => {
    vi.mocked(getBackupInfo).mockResolvedValue({ info });
    vi.mocked(listBackupJobs).mockResolvedValue({ jobs: [succeededBackup] });
    vi.mocked(updateBackupSettings).mockResolvedValue({ settings });
    vi.mocked(startBackupRestore).mockResolvedValue({
      preBackup: succeededBackup,
      restore: runningRestore,
    });
    vi.mocked(deleteBackupJob).mockResolvedValue({ deleted: true });
  });

  it("渲染设置区与备份列表", async () => {
    render(<BackupClient />);
    expect(screen.getByRole("heading", { name: "备份与回滚" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("启用自动备份")).toBeTruthy();
      expect(screen.getByText("立即备份")).toBeTruthy();
      expect(screen.getByText("手动")).toBeTruthy(); // kind 徽标
    });
  });

  it("Vercel 未配置 Neon 时显示不可用面板", async () => {
    vi.mocked(getBackupInfo).mockResolvedValue({
      info: {
        ...info,
        deploymentTarget: "vercel",
        supported: false,
        unavailableReason: "Vercel 备份需要配置 NEON_API_KEY 与 NEON_PROJECT_ID 环境变量",
      },
    });
    render(<BackupClient />);
    await waitFor(() => {
      expect(screen.getByText("备份功能当前不可用")).toBeTruthy();
      expect(screen.queryByText("立即备份")).toBeNull();
    });
  });

  it("保存设置调用 updateBackupSettings", async () => {
    render(<BackupClient />);
    await waitFor(() => {
      expect(screen.getByText("启用自动备份")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => {
      expect(updateBackupSettings).toHaveBeenCalled();
    });
  });

  it("回滚对话框校验确认语后提交", async () => {
    render(<BackupClient />);
    await waitFor(() => {
      expect(screen.getByText("从该备份回滚")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "从该备份回滚" }));
    expect(screen.getByText("从备份回滚")).toBeTruthy();

    // 错误确认语：不提交。
    fireEvent.click(screen.getByRole("button", { name: "确认回滚" }));
    expect(startBackupRestore).not.toHaveBeenCalled();

    // 正确确认语：提交。
    const input = screen.getByPlaceholderText("输入确认语");
    fireEvent.change(input, { target: { value: "CONFIRM-RESTORE" } });
    fireEvent.click(screen.getByRole("button", { name: "确认回滚" }));
    await waitFor(() => {
      expect(startBackupRestore).toHaveBeenCalledWith("b1", {
        confirm: "CONFIRM-RESTORE",
      });
    });
  });

  it("删除对话框确认后调用 deleteBackupJob", async () => {
    render(<BackupClient />);
    await waitFor(() => {
      expect(screen.getByText("从该备份回滚")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(
      screen.getByRole("heading", { name: "删除备份" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除备份" }));
    await waitFor(() => {
      expect(deleteBackupJob).toHaveBeenCalledWith("b1");
    });
  });

  it("三个列表可切换：备份 / 回滚记录 / 回滚前自动备份", async () => {
    vi.mocked(listBackupJobs).mockResolvedValue({
      jobs: [
        { ...succeededBackup, id: "b1", isProtection: true }, // 保护备份
        { ...succeededBackup, id: "b2" }, // 普通手动备份
        {
          ...runningRestore,
          id: "r1",
          status: "succeeded",
          phase: "done",
          restoreFromId: "b2",
        }, // 回滚记录
      ],
    });
    render(<BackupClient />);
    // 默认「备份」列表：只显示普通手动备份。
    await waitFor(() => {
      expect(screen.getByText("手动")).toBeTruthy();
    });
    expect(screen.getByText("#b2")).toBeTruthy();
    expect(screen.queryByText("#b1")).toBeNull();
    expect(screen.queryByText("#r1")).toBeNull();

    // 回滚记录列表：显示回滚徽标与来源备份。
    fireEvent.click(screen.getByRole("tab", { name: /回滚记录/ }));
    await waitFor(() => {
      expect(screen.getByText("回滚")).toBeTruthy();
      expect(screen.getByText(/来源备份 #b2/)).toBeTruthy();
    });
    expect(screen.getByText("#r1")).toBeTruthy();
    expect(screen.queryByText("#b2")).toBeNull();

    // 回滚前自动备份列表：显示保护备份（tab 与徽章文案相同，用 ID 区分）。
    fireEvent.click(screen.getByRole("tab", { name: /回滚前自动备份/ }));
    await waitFor(() => {
      expect(screen.getByText("#b1")).toBeTruthy();
    });
    expect(screen.queryByText("手动")).toBeNull();
  });
});
