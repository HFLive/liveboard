import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassroomSummary } from "@liveboard/shared";
import { ClassroomsClient } from "./ClassroomsClient";
import { getMe, listClassrooms, listVisibilityUsers } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  createClassroom: vi.fn(),
  getMe: vi.fn(),
  listClassrooms: vi.fn(),
  listVisibilityUsers: vi.fn(),
}));

const classroom: ClassroomSummary = {
  id: "classroom-1",
  name: "高等数学",
  description: "第一学期",
  role: "teacher",
  teacherCount: 1,
  studentCount: 30,
  deckCount: 2,
  exerciseCount: 3,
  fileCount: 0,
  storageQuotaBytes: 0,
  storageQuotaCustom: false,
  storageUsedBytes: 0,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

/** 管理员未参与（非成员）的课堂，role 为 administrator。 */
const viewableOnlyClassroom: ClassroomSummary = {
  ...classroom,
  id: "classroom-2",
  name: "物理实验",
  description: "仅查看",
  role: "administrator",
};

describe("ClassroomsClient loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listClassrooms).mockResolvedValue({ classrooms: [classroom] });
    vi.mocked(getMe).mockResolvedValue({
      user: { systemRole: "admin" },
    } as Awaited<ReturnType<typeof getMe>>);
  });

  it("removes list placeholders once classrooms load, without waiting for the create-dialog directory", async () => {
    let resolveUsers: (value: { users: []; tags: [] }) => void;
    vi.mocked(listVisibilityUsers).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUsers = resolve;
        }),
    );

    render(<ClassroomsClient />);

    await screen.findByRole("link", { name: /高等数学/ });
    expect(screen.queryByRole("status", { name: "正在加载课堂" })).toBeNull();

    resolveUsers!({ users: [], tags: [] });
    await waitFor(() => expect(listVisibilityUsers).toHaveBeenCalledTimes(1));
  });

  it("defaults to joined classrooms and switches to all viewable ones", async () => {
    vi.mocked(listClassrooms).mockResolvedValue({
      classrooms: [classroom, viewableOnlyClassroom],
    });
    vi.mocked(listVisibilityUsers).mockResolvedValue({
      users: [],
      tags: [],
    });

    render(<ClassroomsClient />);
    await screen.findByRole("link", { name: /高等数学/ });
    // 默认展示「我参与的」：未参与的课堂（role 为 administrator）隐藏。
    expect(screen.queryByRole("link", { name: /物理实验/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /物理实验/ })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "我参与的" }));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /物理实验/ })).toBeNull(),
    );
    expect(screen.getByRole("link", { name: /高等数学/ })).toBeTruthy();
  });

  it("defaults the creating admin to teacher and warns when not a teacher", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { id: "admin-1", systemRole: "admin" },
    } as Awaited<ReturnType<typeof getMe>>);
    vi.mocked(listVisibilityUsers).mockResolvedValue({
      users: [
        {
          id: "admin-1",
          username: "admin",
          displayName: "Admin",
          avatarUrl: null,
          systemRole: "admin",
          status: "active",
          tags: [],
        },
      ],
      tags: [],
    });

    render(<ClassroomsClient />);
    await screen.findByRole("link", { name: /高等数学/ });

    fireEvent.click(screen.getByRole("button", { name: "新建课堂" }));
    const adminRole = await screen.findByRole("combobox", { name: /Admin/ });
    expect(adminRole).toHaveValue("teacher");
    // 已是教师时不显示失去管理权的提醒。
    expect(screen.queryByText(/只能查看这个课堂/)).toBeNull();

    fireEvent.change(adminRole, { target: { value: "none" } });
    expect(
      screen.getByText(/创建后就只能查看这个课堂，无法再编辑课堂内容/),
    ).toBeTruthy();
  });

  it("hides the view switch for users who are not admins", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { systemRole: "member" },
    } as Awaited<ReturnType<typeof getMe>>);

    render(<ClassroomsClient />);
    await screen.findByRole("link", { name: /高等数学/ });

    expect(screen.queryByRole("button", { name: "我参与的" })).toBeNull();
    expect(screen.queryByRole("button", { name: "全部" })).toBeNull();
    expect(listVisibilityUsers).not.toHaveBeenCalled();
  });
});
