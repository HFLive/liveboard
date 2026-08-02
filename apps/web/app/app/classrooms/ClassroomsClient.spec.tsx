import { render, screen, waitFor } from "@testing-library/react";
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
});
