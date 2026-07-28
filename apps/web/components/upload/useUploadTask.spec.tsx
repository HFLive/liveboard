import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  prepareUploadJobs,
  useUploadTask,
  type UploadOutcome,
} from "./useUploadTask";

describe("prepareUploadJobs", () => {
  it("applies name validation and duplicate detection across a selection", () => {
    const jobs = prepareUploadJobs(
      [
        new File(["a"], "讲义.pdf"),
        new File(["b"], "讲义.pdf"),
        new File(["c"], "非法\u200b名.pdf"),
      ],
      [],
      "本次选择中包含同名文件",
    );

    expect(jobs.map((job) => job.error)).toEqual([
      undefined,
      "本次选择中包含同名文件",
      "文件名称不能包含换行、控制字符或不可见字符",
    ]);
  });
});

describe("useUploadTask", () => {
  it("runs at most two uploads concurrently and preserves outcome order", async () => {
    const { result } = renderHook(() => useUploadTask());
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const uploader = vi.fn(async (job: { filename: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return job.filename;
    });
    const jobs = prepareUploadJobs(
      [
        new File(["a"], "1.pdf"),
        new File(["b"], "2.pdf"),
        new File(["c"], "3.pdf"),
      ],
      [],
      "重复",
    );

    let uploadPromise!: Promise<UploadOutcome<string>[]>;
    act(() => {
      uploadPromise = result.current.uploadFiles(jobs, uploader);
    });
    await waitFor(() => expect(uploader).toHaveBeenCalledTimes(2));
    expect(result.current.tasks.map((task) => task.status)).toEqual([
      "uploading",
      "uploading",
      "queued",
    ]);

    act(() => releases.shift()?.());
    await waitFor(() => expect(uploader).toHaveBeenCalledTimes(3));
    act(() => releases.splice(0).forEach((release) => release()));

    let outcomes!: Awaited<typeof uploadPromise>;
    await act(async () => {
      outcomes = await uploadPromise;
    });
    expect(maxActive).toBe(2);
    expect(outcomes.map((outcome) => outcome.result)).toEqual([
      "1.pdf",
      "2.pdf",
      "3.pdf",
    ]);
  });
});
