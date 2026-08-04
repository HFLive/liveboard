import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MAINTENANCE_OFF,
  readMaintenanceStateFile,
  writeMaintenanceStateFile,
  type MaintenanceState,
} from "./maintenance-file";

describe("maintenance-file", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "maintenance-file-"));
    file = path.join(dir, "maintenance.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns MAINTENANCE_OFF when the file does not exist", async () => {
    await expect(readMaintenanceStateFile(file)).resolves.toEqual(
      MAINTENANCE_OFF,
    );
  });

  it("throws on a corrupt file (fail-closed, not treated as off)", async () => {
    await writeFile(file, "{ not valid json", "utf8");
    await expect(readMaintenanceStateFile(file)).rejects.toThrow();
  });

  it("round-trips a written state", async () => {
    const state: MaintenanceState = {
      enabled: true,
      reason: "升级服务器",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "user-1",
    };
    await writeMaintenanceStateFile(file, state);
    await expect(readMaintenanceStateFile(file)).resolves.toEqual(state);
  });

  it("keeps the file valid under concurrent writes (unique temp names)", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        writeMaintenanceStateFile(file, {
          enabled: index % 2 === 0,
          reason: null,
          updatedAt: `2026-01-01T00:00:0${index}.000Z`,
          updatedBy: "user-1",
        }),
      ),
    );
    const state = await readMaintenanceStateFile(file);
    expect(typeof state.enabled).toBe("boolean");
    expect(state.updatedBy).toBe("user-1");
  });
});
