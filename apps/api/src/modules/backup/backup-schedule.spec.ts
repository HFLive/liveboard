import {
  initialLastAutoBackupAt,
  periodFireTime,
  retentionCandidates,
  shouldRunAutoBackup,
} from "./backup-schedule";

// 调度时刻按本地时区解释（用户设置的「3:00」即本地 3:00），测试全部用本地时间构造。
// 2026-08-07 是周五（getDay=5）。
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 7, day, hour, minute, 0, 0);
const FRIDAY_1030 = at(7, 10, 30);

const base = {
  enabled: true,
  scheduleHour: 3,
  scheduleMinute: 0,
  scheduleWeekday: null,
};

describe("shouldRunAutoBackup（固定时刻语义）", () => {
  it("不启用时不跑", () => {
    expect(
      shouldRunAutoBackup(
        { ...base, enabled: false, lastAutoBackupAt: null },
        FRIDAY_1030,
      ),
    ).toBe(false);
  });

  it("从未跑过（lastAutoBackupAt 为空）不跑：首次启用由 updateSettings 置位，严格到点", () => {
    expect(
      shouldRunAutoBackup({ ...base, lastAutoBackupAt: null }, FRIDAY_1030),
    ).toBe(false);
  });

  it("本周期还没到点不跑（每天 12:00，现在 10:30）", () => {
    expect(
      shouldRunAutoBackup(
        {
          ...base,
          scheduleHour: 12,
          lastAutoBackupAt: at(6, 12),
        },
        FRIDAY_1030,
      ),
    ).toBe(false);
  });

  it("到点窗口内且上次早于本周期调度点 → 跑（3:00 到点，3:05 判定）", () => {
    expect(
      shouldRunAutoBackup(
        {
          ...base,
          scheduleHour: 3,
          lastAutoBackupAt: at(6, 3),
        },
        at(7, 3, 5),
      ),
    ).toBe(true);
  });

  it("到点窗口内但本班已跑（今天 3:02 完成）→ 不跑", () => {
    expect(
      shouldRunAutoBackup(
        {
          ...base,
          scheduleHour: 3,
          lastAutoBackupAt: at(7, 3, 2),
        },
        at(7, 3, 5),
      ),
    ).toBe(false);
  });

  it("错过：3:00 到点后超过触发窗口（10 分钟）→ 跳过不补跑", () => {
    expect(
      shouldRunAutoBackup(
        {
          ...base,
          scheduleHour: 3,
          lastAutoBackupAt: at(6, 3),
        },
        at(7, 3, 11),
      ),
    ).toBe(false);
  });

  it("错过：停机到第二天恢复（上次 8 月 6 日）→ 跳过今天这班，明天才跑", () => {
    expect(
      shouldRunAutoBackup(
        {
          ...base,
          scheduleHour: 3,
          lastAutoBackupAt: at(6, 10),
        },
        FRIDAY_1030,
      ),
    ).toBe(false);
  });

  it("每周：本周期到点窗口内且未跑 → 跑（本周三 3:05）", () => {
    expect(
      shouldRunAutoBackup(
        {
          ...base,
          scheduleWeekday: 3, // 周三
          lastAutoBackupAt: new Date(at(5, 3).getTime() - 7 * 24 * 3600 * 1000), // 上周三 3:00
        },
        at(5, 3, 5),
      ),
    ).toBe(true);
  });

  it("每周：本周期到点窗口内但本班已跑（周三 9:00 完成）→ 不跑", () => {
    expect(
      shouldRunAutoBackup(
        {
          ...base,
          scheduleWeekday: 3,
          lastAutoBackupAt: at(5, 9),
        },
        at(5, 3, 5),
      ),
    ).toBe(false);
  });

  it("每周：错过本周三的班（周五才恢复）→ 跳过，下周才跑", () => {
    expect(
      shouldRunAutoBackup(
        {
          ...base,
          scheduleWeekday: 3,
          lastAutoBackupAt: new Date(at(5, 3).getTime() - 7 * 24 * 3600 * 1000),
        },
        FRIDAY_1030,
      ),
    ).toBe(false);
  });

  it("每周：本周期还没到点（周六 20:00，现在周五 10:30）→ 不跑", () => {
    expect(
      shouldRunAutoBackup(
        {
          ...base,
          scheduleWeekday: 6,
          scheduleHour: 20,
          lastAutoBackupAt: at(1, 20),
        },
        FRIDAY_1030,
      ),
    ).toBe(false);
  });
});

describe("periodFireTime", () => {
  it("每天：返回今天 HH:MM", () => {
    const fire = periodFireTime(
      { scheduleHour: 3, scheduleMinute: 30, scheduleWeekday: null },
      FRIDAY_1030,
    );
    expect(fire.getTime()).toBe(at(7, 3, 30).getTime());
  });

  it("每周：本周该 weekday 的 HH:MM（周三，可能在过去）", () => {
    const fire = periodFireTime(
      { scheduleHour: 3, scheduleMinute: 0, scheduleWeekday: 3 },
      FRIDAY_1030,
    );
    expect(fire.getTime()).toBe(at(5, 3).getTime());
  });

  it("每周：本周该 weekday 在未来（周六）", () => {
    const fire = periodFireTime(
      { scheduleHour: 3, scheduleMinute: 0, scheduleWeekday: 6 },
      FRIDAY_1030,
    );
    expect(fire.getTime()).toBe(at(8, 3).getTime());
  });
});

describe("initialLastAutoBackupAt（首次启用置位）", () => {
  it("本周期已到点：置为本周期调度点（本班视为已跑，下一周期才跑）", () => {
    const last = initialLastAutoBackupAt(
      { scheduleHour: 3, scheduleMinute: 0, scheduleWeekday: null },
      FRIDAY_1030,
    );
    expect(new Date(last).getTime()).toBe(at(7, 3).getTime());
  });

  it("本周期未到点：置为上一周期调度点（到点即跑第一班）", () => {
    const last = initialLastAutoBackupAt(
      { scheduleHour: 20, scheduleMinute: 0, scheduleWeekday: null },
      FRIDAY_1030,
    );
    expect(new Date(last).getTime()).toBe(at(6, 20).getTime());
  });

  it("每周：置位按周周期（本周已到点 → 本周三；未到点 → 上周三）", () => {
    expect(
      new Date(
        initialLastAutoBackupAt(
          { scheduleHour: 3, scheduleMinute: 0, scheduleWeekday: 3 },
          FRIDAY_1030,
        ),
      ).getTime(),
    ).toBe(at(5, 3).getTime());
    expect(
      new Date(
        initialLastAutoBackupAt(
          { scheduleHour: 3, scheduleMinute: 0, scheduleWeekday: 6 },
          FRIDAY_1030,
        ),
      ).getTime(),
    ).toBe(at(1, 3).getTime());
  });
});

describe("retentionCandidates", () => {
  const row = (overrides: Partial<Parameters<typeof retentionCandidates>[0][number]>) => ({
    id: `b-${Math.random().toString(36).slice(2, 8)}`,
    kind: "auto" as const,
    status: "succeeded",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    restoreFromId: null,
    ...overrides,
  });

  it("超出限额返回最旧的候选", () => {
    const rows = [1, 2, 3, 4, 5].map((day) =>
      row({ id: `b${day}`, createdAt: new Date(`2026-08-0${day}T00:00:00Z`) }),
    );
    const candidates = retentionCandidates(rows, 3);
    expect(candidates.map((r) => r.id)).toEqual(["b1", "b2"]);
  });

  it("未超限额不返回", () => {
    const rows = [1, 2, 3].map((day) =>
      row({ id: `b${day}`, createdAt: new Date(`2026-08-0${day}T00:00:00Z`) }),
    );
    expect(retentionCandidates(rows, 3)).toEqual([]);
  });

  it("失败的备份不占额度", () => {
    const rows = [1, 2, 3, 4].map((day) =>
      row({
        id: `b${day}`,
        status: day === 3 ? "failed" : "succeeded",
        createdAt: new Date(`2026-08-0${day}T00:00:00Z`),
      }),
    );
    const candidates = retentionCandidates(rows, 2);
    // 有效成功备份 3 个（b1/b2/b4），限额 2 → 删最旧的 b1。
    expect(candidates.map((r) => r.id)).toEqual(["b1"]);
  });

  it("被未终态 restore 引用的备份跳过", () => {
    const rows = [1, 2, 3, 4].map((day) =>
      row({
        id: `b${day}`,
        createdAt: new Date(`2026-08-0${day}T00:00:00Z`),
      }),
    );
    rows.push({
      id: "r1",
      kind: "restore" as const,
      status: "running",
      createdAt: new Date("2026-08-05T00:00:00Z"),
      restoreFromId: "b1",
    });
    const candidates = retentionCandidates(rows, 2);
    // b1 被运行中的回滚引用 → 保留；b2 被删。
    expect(candidates.map((r) => r.id)).toEqual(["b2"]);
  });

  it("失败状态的 restore 引用不保护", () => {
    const rows = [1, 2, 3, 4].map((day) =>
      row({
        id: `b${day}`,
        createdAt: new Date(`2026-08-0${day}T00:00:00Z`),
      }),
    );
    rows.push({
      id: "r1",
      kind: "restore" as const,
      status: "failed",
      createdAt: new Date("2026-08-05T00:00:00Z"),
      restoreFromId: "b1",
    });
    const candidates = retentionCandidates(rows, 2);
    expect(candidates.map((r) => r.id)).toEqual(["b1", "b2"]);
  });
});
