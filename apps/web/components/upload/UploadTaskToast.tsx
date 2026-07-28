"use client";

import {
  AlertCircle,
  CheckCircle2,
  CircleX,
  Clock3,
  LoaderCircle,
  X,
} from "lucide-react";
import type { UploadTask } from "./useUploadTask";
import styles from "./UploadTaskToast.module.css";

export function UploadTaskToast({
  tasks,
  onCancel,
  onDismiss,
}: {
  tasks: UploadTask[];
  onCancel: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
}) {
  if (tasks.length === 0) return null;

  const uploadingCount = tasks.filter(
    (task) => task.status === "uploading",
  ).length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;
  const completedCount = tasks.filter(
    (task) => task.status === "success",
  ).length;
  const title =
    tasks.length === 1
      ? taskStatusLabel(tasks[0]!)
      : uploadingCount > 0
        ? `正在上传 ${uploadingCount} 个文件`
        : queuedCount > 0
          ? `等待上传 ${queuedCount} 个文件`
          : `上传任务 · ${completedCount}/${tasks.length} 完成`;

  return (
    <aside
      aria-atomic="false"
      aria-label="文件上传任务"
      aria-live="polite"
      className={styles.toast}
    >
      <div className={styles.heading}>
        <strong>{title}</strong>
        <span>{tasks.length} 项</span>
      </div>
      <div className={styles.taskList}>
        {tasks.map((task) => {
          const active =
            task.status === "queued" || task.status === "uploading";
          const StatusIcon =
            task.status === "success"
              ? CheckCircle2
              : task.status === "error"
                ? AlertCircle
                : task.status === "cancelled"
                  ? CircleX
                  : task.status === "queued"
                    ? Clock3
                    : LoaderCircle;

          return (
            <div
              className={styles.task}
              data-status={task.status}
              key={task.id}
            >
              <StatusIcon
                aria-hidden="true"
                className={
                  task.status === "uploading" ? styles.spinning : undefined
                }
              />
              <div className={styles.taskBody}>
                <div className={styles.fileRow}>
                  <span title={task.filename}>{task.filename}</span>
                  {task.status === "uploading" ? (
                    <em>{task.progress}%</em>
                  ) : task.status === "queued" ? (
                    <em>等待中</em>
                  ) : null}
                </div>
                {active ? (
                  <div
                    aria-label={`${task.filename}上传进度 ${task.progress}%`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={task.progress}
                    className={styles.progress}
                    role="progressbar"
                  >
                    <span style={{ width: `${task.progress}%` }} />
                  </div>
                ) : null}
                {task.message ? <p>{task.message}</p> : null}
              </div>
              <button
                aria-label={
                  active
                    ? `取消上传“${task.filename}”`
                    : `关闭“${task.filename}”`
                }
                onClick={() =>
                  active ? onCancel(task.id) : onDismiss(task.id)
                }
                title={active ? "取消上传" : "关闭"}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function taskStatusLabel(task: UploadTask) {
  if (task.status === "success") return "上传完成";
  if (task.status === "error") return "上传失败";
  if (task.status === "cancelled") return "上传已取消";
  if (task.status === "queued") return "等待上传";
  return task.progress >= 100 ? "正在保存" : "正在上传";
}
