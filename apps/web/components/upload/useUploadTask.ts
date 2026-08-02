"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadRequestOptions } from "@/lib/api/client";
import {
  getResourceNameError,
  normalizeResourceName,
} from "@liveboard/shared/resource-name";

const MAX_CONCURRENT_UPLOADS = 2;
const AUTO_DISMISS_DELAY_MS = 2_800;

export type UploadTaskStatus =
  "queued" | "uploading" | "success" | "error" | "cancelled";

export interface UploadTask {
  id: string;
  filename: string;
  progress: number;
  status: UploadTaskStatus;
  message?: string;
}

export interface UploadJob {
  file: File;
  filename: string;
  error?: string;
}

export interface UploadOutcome<T> {
  job: UploadJob;
  result?: T;
  error?: unknown;
  cancelled: boolean;
}

export function isUploadCancelled(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function prepareUploadJobs(
  files: File[],
  existingNames: Iterable<string>,
  duplicateMessage: string,
) {
  const occupiedNames = new Set(existingNames);
  return files.map<UploadJob>((file) => {
    const nameError = getResourceNameError(file.name, "文件名称");
    const filename = nameError ? file.name : normalizeResourceName(file.name);
    const duplicate = !nameError && occupiedNames.has(filename);

    if (!nameError && !duplicate) occupiedNames.add(filename);
    return {
      file,
      filename,
      error: nameError ?? (duplicate ? duplicateMessage : undefined),
    };
  });
}

export function useUploadTask() {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());
  const dismissTimersRef = useRef(new Map<string, number>());
  const sequenceRef = useRef(0);

  const dismissUpload = useCallback((taskId: string) => {
    const timer = dismissTimersRef.current.get(taskId);
    if (timer) window.clearTimeout(timer);
    dismissTimersRef.current.delete(taskId);
    setTasks((current) => current.filter((task) => task.id !== taskId));
  }, []);

  const scheduleDismiss = useCallback(
    (taskId: string) => {
      const previous = dismissTimersRef.current.get(taskId);
      if (previous) window.clearTimeout(previous);
      dismissTimersRef.current.set(
        taskId,
        window.setTimeout(() => dismissUpload(taskId), AUTO_DISMISS_DELAY_MS),
      );
    },
    [dismissUpload],
  );

  useEffect(
    () => () => {
      controllersRef.current.forEach((controller) => controller.abort());
      dismissTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const updateTask = useCallback(
    (taskId: string, update: (task: UploadTask) => UploadTask) => {
      setTasks((current) =>
        current.map((task) => (task.id === taskId ? update(task) : task)),
      );
    },
    [],
  );

  const cancelUpload = useCallback(
    (taskId: string) => {
      const controller = controllersRef.current.get(taskId);
      if (!controller) return;
      controller.abort();
      updateTask(taskId, (current) => ({
        ...current,
        status: "cancelled",
        message: "已取消并清理上传",
      }));
      scheduleDismiss(taskId);
    },
    [scheduleDismiss, updateTask],
  );

  const uploadFiles = useCallback(
    async <T>(
      jobs: UploadJob[],
      uploader: (job: UploadJob, options: UploadRequestOptions) => Promise<T>,
    ): Promise<UploadOutcome<T>[]> => {
      const queued = jobs.map((job) => {
        sequenceRef.current += 1;
        const taskId = `upload-${Date.now()}-${sequenceRef.current}`;
        const controller = job.error ? null : new AbortController();
        if (controller) controllersRef.current.set(taskId, controller);
        return {
          job,
          controller,
          task: {
            id: taskId,
            filename: job.filename,
            progress: 0,
            status: job.error ? ("error" as const) : ("queued" as const),
            message: job.error,
          },
        };
      });
      setTasks((current) => [...current, ...queued.map(({ task }) => task)]);

      const outcomes: UploadOutcome<T>[] = jobs.map((job) => ({
        job,
        cancelled: false,
      }));
      const runnable = queued
        .map((entry, index) => ({ ...entry, index }))
        .filter(({ job }) => !job.error);
      queued.forEach(({ job }, index) => {
        if (job.error) outcomes[index]!.error = new Error(job.error);
      });

      let cursor = 0;
      const worker = async () => {
        while (cursor < runnable.length) {
          const currentIndex = cursor;
          cursor += 1;
          const entry = runnable[currentIndex];
          if (!entry) continue;

          const { task, job, index, controller } = entry;
          const outcome = outcomes[index]!;
          if (!controller || controller.signal.aborted) {
            outcome.error = new DOMException("上传已取消", "AbortError");
            outcome.cancelled = true;
            controllersRef.current.delete(task.id);
            continue;
          }
          updateTask(task.id, (current) => ({
            ...current,
            status: current.status === "cancelled" ? "cancelled" : "uploading",
          }));

          try {
            const result = await uploader(job, {
              signal: controller.signal,
              onProgress: (progress) =>
                updateTask(task.id, (current) =>
                  current.status === "uploading"
                    ? {
                        ...current,
                        progress: Math.min(100, Math.max(0, progress)),
                      }
                    : current,
                ),
            });
            outcome.result = result;
            updateTask(task.id, (current) => ({
              ...current,
              progress: 100,
              status: "success",
              message: undefined,
            }));
            scheduleDismiss(task.id);
          } catch (caught) {
            const cancelled = isUploadCancelled(caught);
            outcome.error = caught;
            outcome.cancelled = cancelled;
            updateTask(task.id, (current) => ({
              ...current,
              status: cancelled ? "cancelled" : "error",
              message: cancelled
                ? "已取消并清理上传"
                : caught instanceof Error
                  ? caught.message
                  : "上传失败",
            }));
            if (cancelled) scheduleDismiss(task.id);
          } finally {
            controllersRef.current.delete(task.id);
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(MAX_CONCURRENT_UPLOADS, runnable.length) },
          () => worker(),
        ),
      );
      return outcomes;
    },
    [scheduleDismiss, updateTask],
  );

  return {
    tasks,
    uploadFiles,
    cancelUpload,
    dismissUpload,
  };
}
