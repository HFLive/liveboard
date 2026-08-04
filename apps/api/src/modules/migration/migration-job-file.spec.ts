import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readJobState, writeJobState } from "./migration-job-file";

describe("migration-job-file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "migration-job-file-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes and reads back a state", async () => {
    await writeJobState(dir, "job-1", {
      kind: "import",
      status: "running",
      phase: "import/objects",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const state = await readJobState(dir, "job-1");
    expect(state?.status).toBe("running");
    expect(state?.kind).toBe("import");
    expect(state?.phase).toBe("import/objects");
    expect(state?.updatedAt).toBeTruthy();
  });

  it("keeps the file valid under concurrent writes (unique temp names + serialized)", async () => {
    // 修复前固定 `${file}.tmp` + 原子 rename 在并发下会让后写者 rename ENOENT
    // 抛错（Promise.all 整体拒绝），且 read-modify-write 互相覆盖；修复后应全部
    // 成功、终态为最后入队的写。
    const writes = Array.from({ length: 30 }, (_, index) =>
      writeJobState(dir, "job-1", {
        status: "running",
        progress: { done: index + 1, total: 30 },
      }),
    );
    writes.push(
      writeJobState(dir, "job-1", {
        status: "succeeded",
        progress: { done: 30, total: 30 },
      }),
    );
    await expect(Promise.all(writes)).resolves.toHaveLength(31);

    const state = await readJobState(dir, "job-1");
    expect(state?.status).toBe("succeeded");
    expect(state?.progress?.done).toBe(30);
  });

  it("does not throw when parallel workers report progress", async () => {
    await expect(
      Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          writeJobState(dir, "job-1", {
            phase: "import/objects",
            progress: { done: index + 1, total: 20 },
          }),
        ),
      ),
    ).resolves.toHaveLength(20);
  });
});
