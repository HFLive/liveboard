"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, ChevronDown } from "lucide-react";
import type {
  UserContributionCategory,
  UserContributionSummary,
} from "@liveboard/shared";
import { getUserContributions } from "@/lib/api";

const CATEGORY_LABELS: Record<UserContributionCategory, string> = {
  learning: "学习",
  teaching: "教学",
  community: "论坛",
  resources: "资源",
};

const WEEKDAY_LABELS = ["一", "", "三", "", "五", "", ""];

export function UserContributionHeatmap({ userId }: { userId: string }) {
  const [selection, setSelection] = useState<"last_year" | number>("last_year");
  const [summary, setSummary] = useState<UserContributionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const yearMenuRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    function closeYearMenu(event: PointerEvent) {
      if (
        yearMenuRef.current?.open &&
        !yearMenuRef.current.contains(event.target as Node)
      ) {
        yearMenuRef.current.open = false;
      }
    }

    function closeYearMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && yearMenuRef.current?.open) {
        yearMenuRef.current.open = false;
        yearMenuRef.current.querySelector("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", closeYearMenu);
    document.addEventListener("keydown", closeYearMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeYearMenu);
      document.removeEventListener("keydown", closeYearMenuOnEscape);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getUserContributions(userId, selection)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "加载贡献记录失败",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selection, userId]);

  const calendar = useMemo(
    () => (summary ? buildContributionCalendar(summary) : null),
    [summary],
  );

  useEffect(() => {
    if (!calendar || !scrollRef.current) return;
    scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [calendar]);

  if (loading && !summary) {
    return <div className="skeleton contribution-skeleton" />;
  }

  if (error) {
    return <p className="muted contribution-message">贡献记录暂时无法加载。</p>;
  }

  if (!summary || !calendar) return null;

  const title =
    summary.range.mode === "last_year"
      ? `过去一年共 ${summary.total} 次贡献`
      : `${summary.range.year} 年共 ${summary.total} 次贡献`;

  return (
    <section
      className="user-contributions"
      aria-labelledby="contribution-title"
    >
      <div className="contribution-head">
        <h2 id="contribution-title">{title}</h2>
        <details className="contribution-year-picker" ref={yearMenuRef}>
          <summary
            aria-disabled={loading}
            aria-label={`选择贡献年份，当前为${selection === "last_year" ? "过去 12 个月" : `${selection} 年`}`}
            onClick={(event) => {
              if (loading) event.preventDefault();
            }}
          >
            <span>
              {selection === "last_year" ? "过去 12 个月" : `${selection} 年`}
            </span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="contribution-year-options" role="menu">
            <button
              className={selection === "last_year" ? "active" : ""}
              disabled={loading}
              onClick={() => {
                setSelection("last_year");
                if (yearMenuRef.current) yearMenuRef.current.open = false;
              }}
              role="menuitemradio"
              aria-checked={selection === "last_year"}
              type="button"
            >
              <Check aria-hidden="true" />
              <span>过去 12 个月</span>
            </button>
            {summary.availableYears.map((year) => (
              <button
                className={selection === year ? "active" : ""}
                disabled={loading}
                key={year}
                onClick={() => {
                  setSelection(year);
                  if (yearMenuRef.current) yearMenuRef.current.open = false;
                }}
                role="menuitemradio"
                aria-checked={selection === year}
                type="button"
              >
                <Check aria-hidden="true" />
                <span>{year} 年</span>
              </button>
            ))}
          </div>
        </details>
      </div>

      <div
        aria-busy={loading}
        className={`contribution-scroll ${loading ? "is-loading" : ""}`}
        ref={scrollRef}
      >
        <div
          className="contribution-calendar"
          style={
            { "--contribution-weeks": calendar.weeks.length } as CSSProperties
          }
        >
          <div className="contribution-months" aria-hidden="true">
            <span />
            <div>
              {calendar.months.map((month) => (
                <span
                  key={`${month.label}-${month.column}`}
                  style={{ gridColumn: month.column }}
                >
                  {month.label}
                </span>
              ))}
            </div>
          </div>
          <div className="contribution-grid-row">
            <div className="contribution-weekdays" aria-hidden="true">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={index}>{label}</span>
              ))}
            </div>
            <div className="contribution-weeks" role="grid" aria-label={title}>
              {calendar.weeks.map((week, weekIndex) => (
                <div className="contribution-week" key={weekIndex}>
                  {week.map((day) => (
                    <span
                      aria-label={day.label}
                      className={`contribution-day level-${day.level}${day.inRange ? "" : " outside"}`}
                      key={day.date}
                      role="gridcell"
                      tabIndex={day.inRange && day.count > 0 ? 0 : -1}
                      title={day.label}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="contribution-footer">
        <div className="contribution-categories" aria-label="贡献构成">
          {summary.categories
            .filter(({ count }) => count > 0)
            .map(({ category, count }) => (
              <span key={category}>
                {CATEGORY_LABELS[category]} {count}
              </span>
            ))}
        </div>
        <div className="contribution-legend" aria-label="贡献次数图例">
          <span>较少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i className={`contribution-day level-${level}`} key={level} />
          ))}
          <span>较多</span>
        </div>
      </div>
    </section>
  );
}

function buildContributionCalendar(summary: UserContributionSummary) {
  const countByDate = new Map(
    summary.days.map(({ date, count }) => [date, count]),
  );
  const start = dateKeyToUtc(summary.range.from);
  const end = dateKeyToUtc(summary.range.to);
  const calendarStart = new Date(start);
  calendarStart.setUTCDate(
    calendarStart.getUTCDate() - ((calendarStart.getUTCDay() + 6) % 7),
  );
  const calendarEnd = new Date(end);
  calendarEnd.setUTCDate(
    calendarEnd.getUTCDate() + ((7 - calendarEnd.getUTCDay()) % 7),
  );

  const flatDays: Array<{
    date: string;
    count: number;
    inRange: boolean;
    label: string;
    level: number;
  }> = [];
  for (
    const cursor = new Date(calendarStart);
    cursor <= calendarEnd;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    const count = countByDate.get(date) ?? 0;
    const inRange = date >= summary.range.from && date <= summary.range.to;
    flatDays.push({
      date,
      count,
      inRange,
      label: `${formatChineseDate(date)} · ${count} 次贡献`,
      level: contributionLevel(count),
    });
  }

  const weeks = Array.from(
    { length: Math.ceil(flatDays.length / 7) },
    (_, index) => flatDays.slice(index * 7, index * 7 + 7),
  );
  const months: Array<{ column: number; label: string }> = [];
  let previousMonth = "";
  weeks.forEach((week, index) => {
    const firstInRange = week.find((day) => day.inRange);
    if (!firstInRange) return;
    const month = firstInRange.date.slice(0, 7);
    if (month !== previousMonth) {
      months.push({
        column: index + 1,
        label: `${Number(month.slice(5, 7))}月`,
      });
      previousMonth = month;
    }
  });

  return { months, weeks };
}

function contributionLevel(count: number) {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function dateKeyToUtc(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function formatChineseDate(dateKey: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(dateKeyToUtc(dateKey));
}
