import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadMigrationExport,
  getAdminMaintenance,
  getMigrationInfo,
  listMigrationIncoming,
  listMigrationJobs,
  startMigrationImport,
  type IncomingPackage,
  type MigrationInfo,
  type MigrationJobSummary,
} from "@/lib/api";
import { MigrationClient } from "./MigrationClient";

vi.mock("@/lib/api", () => ({
  downloadMigrationExport: vi.fn(),
  getAdminMaintenance: vi.fn(),
  getMigrationInfo: vi.fn(),
  listMigrationIncoming: vi.fn(),
  listMigrationJobs: vi.fn(),
  setMaintenanceEnabled: vi.fn(),
  startMigrationExport: vi.fn(),
  startMigrationImport: vi.fn(),
  uploadMigrationPackage: vi.fn(),
}));

vi.mock("@/lib/labels", () => ({
  formatDateTime: vi.fn(() => "2026-01-01"),
}));

vi.mock("@/components/admin/AdminPageHeader", () => ({
  AdminPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const info: MigrationInfo = {
  available: true,
  dataDir: "/data/migration",
  confirmPhrase: "CONFIRM-IMPORT",
  maxUploadSizeBytes: 100 * 1024 * 1024,
  deploymentTarget: "server",
  targetBackend: "minio",
};

const packageItem: IncomingPackage = {
  name: "liveboard-migration-a.tar",
  type: "tar",
  sizeBytes: 1024,
  hasManifest: true,
};

const runningJob: MigrationJobSummary = {
  id: "job-running",
  kind: "export",
  status: "running",
  phase: "dump",
  progress: { done: 0, total: 1 },
  packageName: null,
  appVersion: null,
  error: null,
  createdBy: null,
  createdAt: null,
  startedAt: null,
  finishedAt: null,
  updatedAt: null,
};

const succeededExport: MigrationJobSummary = {
  id: "job-export",
  kind: "export",
  status: "succeeded",
  phase: "done",
  progress: null,
  packageName: "liveboard-migration-a.tar",
  appVersion: null,
  error: null,
  createdBy: null,
  createdAt: null,
  startedAt: null,
  finishedAt: null,
  updatedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(getMigrationInfo).mockResolvedValue({ info });
  vi.mocked(getAdminMaintenance).mockResolvedValue({
    maintenance: { enabled: false, reason: null, updatedAt: null, updatedBy: null },
  });
  vi.mocked(listMigrationIncoming).mockResolvedValue({
    packages: [packageItem],
  });
  vi.mocked(listMigrationJobs).mockResolvedValue({ jobs: [] });
});

describe("MigrationClient", () => {
  it("shows an error banner when the initial load fails", async () => {
    vi.mocked(getMigrationInfo).mockRejectedValue(new Error("Forbidden"));

    render(<MigrationClient />);

    await waitFor(() =>
      expect(screen.getByText(/无法加载迁移信息/)).toBeInTheDocument(),
    );
  });

  it("clears the selected package and confirm input after starting an import", async () => {
    vi.mocked(startMigrationImport).mockResolvedValue({ job: {} as never });

    render(<MigrationClient />);
    await waitFor(() => expect(screen.getByRole("radio")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio"));
    fireEvent.change(screen.getByPlaceholderText("CONFIRM-IMPORT"), {
      target: { value: "CONFIRM-IMPORT" },
    });
    fireEvent.click(screen.getByRole("button", { name: /清空并导入/ }));

    await waitFor(() => expect(startMigrationImport).toHaveBeenCalledTimes(1));
    // 导入启动成功后选择与确认语被清空，导入按钮回到禁用态。
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /清空并导入/ }),
      ).toBeDisabled(),
    );
  });

  it("delays revoking the download object URL", async () => {
    const setT = vi.spyOn(window, "setTimeout");
    vi.mocked(listMigrationJobs).mockResolvedValue({
      jobs: [succeededExport],
    });
    vi.mocked(downloadMigrationExport).mockResolvedValue(new Blob(["x"]));

    render(<MigrationClient />);
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /浏览器下载/ }).length,
      ).toBeGreaterThanOrEqual(1),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /浏览器下载/ })[0]!);
    await waitFor(() =>
      expect(downloadMigrationExport).toHaveBeenCalledTimes(1),
    );
    expect(setT).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it("polls while a job is running", async () => {
    const setI = vi.spyOn(window, "setInterval");
    vi.mocked(listMigrationJobs).mockResolvedValue({ jobs: [runningJob] });

    render(<MigrationClient />);

    await waitFor(() =>
      expect(setI).toHaveBeenCalledWith(expect.any(Function), 4000),
    );
  });
});
