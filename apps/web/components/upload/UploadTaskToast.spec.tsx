import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UploadTaskToast } from "./UploadTaskToast";

describe("UploadTaskToast", () => {
  it("shows per-file progress and lets the user cancel that task", () => {
    const onCancel = vi.fn();

    render(
      <UploadTaskToast
        onCancel={onCancel}
        onDismiss={vi.fn()}
        tasks={[
          {
            id: "task-1",
            filename: "课程讲义.pdf",
            progress: 42,
            status: "uploading",
          },
        ]}
      />,
    );

    expect(screen.getByText("课程讲义.pdf")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    fireEvent.click(screen.getByRole("button", { name: /取消上传/ }));
    expect(onCancel).toHaveBeenCalledWith("task-1");
  });

  it("does not repeat the success label below the progress area", () => {
    render(
      <UploadTaskToast
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
        tasks={[
          {
            id: "task-1",
            filename: "课程讲义.pdf",
            progress: 100,
            status: "success",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("上传完成")).toHaveLength(1);
    expect(screen.getByText("课程讲义.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("lists multiple files with independent states", () => {
    render(
      <UploadTaskToast
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
        tasks={[
          {
            id: "task-1",
            filename: "第一章.pdf",
            progress: 68,
            status: "uploading",
          },
          {
            id: "task-2",
            filename: "第二章.pdf",
            progress: 0,
            status: "queued",
          },
          {
            id: "task-3",
            filename: "第三章.pdf",
            progress: 0,
            status: "error",
            message: "当前文件夹中已存在同名文件",
          },
        ]}
      />,
    );

    expect(screen.getByText("正在上传 1 个文件")).toBeInTheDocument();
    expect(screen.getByText("等待中")).toBeInTheDocument();
    expect(screen.getByText("当前文件夹中已存在同名文件")).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("shows server-processing state instead of a fake 100% while awaiting response", () => {
    render(
      <UploadTaskToast
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
        tasks={[
          {
            id: "task-1",
            filename: "课程讲义.pdf",
            progress: 90,
            status: "uploading",
          },
        ]}
      />,
    );

    expect(screen.getByText("正在保存")).toBeInTheDocument();
    expect(screen.getByText("服务器处理中…")).toBeInTheDocument();
    expect(screen.queryByText("90%")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "90",
    );
  });

  it("keeps upload failures visible until dismissed", () => {
    const onDismiss = vi.fn();

    render(
      <UploadTaskToast
        onCancel={vi.fn()}
        onDismiss={onDismiss}
        tasks={[
          {
            id: "task-1",
            filename: "课程讲义.pdf",
            progress: 68,
            status: "error",
            message: "网络连接中断，请重新上传",
          },
        ]}
      />,
    );

    expect(screen.getByText("上传失败")).toBeInTheDocument();
    expect(screen.getByText("网络连接中断，请重新上传")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭“课程讲义.pdf”" }));
    expect(onDismiss).toHaveBeenCalledWith("task-1");
  });
});
