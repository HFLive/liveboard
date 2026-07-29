"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotificationCategory, NotificationItem } from "@liveboard/shared";
import {
  archiveNotification,
  listNotifications,
  markAllNotificationsRead,
  setNotificationRead,
} from "@/lib/api";
import {
  FeedbackNotice,
  useFeedbackNotice,
} from "@/components/system/FeedbackNotice";
import { NotificationList } from "@/components/notifications/NotificationList";
import {
  broadcastNotificationsUpdated,
  NOTIFICATIONS_UPDATED_EVENT,
  type NotificationUpdateSource,
} from "@/lib/notifications";
import styles from "./messages.module.css";

type StatusFilter = "all" | "unread";
type CategoryFilter = "all" | NotificationCategory;

const CATEGORY_OPTIONS: Array<{
  value: CategoryFilter;
  label: string;
}> = [
  { value: "all", label: "全部类型" },
  { value: "task", label: "待处理" },
  { value: "classroom", label: "课堂" },
  { value: "feedback", label: "反馈" },
  { value: "interaction", label: "互动" },
  { value: "permission", label: "权限" },
  { value: "system", label: "系统" },
];

export function NotificationsClient() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorNotice, setError] = useFeedbackNotice();

  const load = useCallback(
    async (cursor?: string) => {
      const result = await listNotifications({
        status,
        category: category === "all" ? undefined : category,
        cursor,
        limit: 30,
      });
      setItems((current) =>
        cursor ? [...current, ...result.items] : result.items,
      );
      setUnreadCount(result.unreadCount);
      setNextCursor(result.nextCursor);
    },
    [category, status],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listNotifications({
      status,
      category: category === "all" ? undefined : category,
      limit: 30,
    })
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setUnreadCount(result.unreadCount);
        setNextCursor(result.nextCursor);
      })
      .catch(() => {
        if (active) setError("消息加载失败，请稍后重试");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [category, setError, status]);

  useEffect(() => {
    const onNotificationsUpdated = (event: Event) => {
      if ((event as CustomEvent<NotificationUpdateSource>).detail !== "page") {
        void load().catch(() => {
          setError("消息刷新失败，请稍后重试");
        });
      }
    };
    window.addEventListener(
      NOTIFICATIONS_UPDATED_EVENT,
      onNotificationsUpdated,
    );
    return () =>
      window.removeEventListener(
        NOTIFICATIONS_UPDATED_EVENT,
        onNotificationsUpdated,
      );
  }, [load]);

  async function toggleRead(item: NotificationItem) {
    const read = item.unread;
    setItems((current) =>
      current
        .map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, unread: !read }
            : candidate,
        )
        .filter((candidate) => status !== "unread" || candidate.unread),
    );
    setUnreadCount((current) => Math.max(0, current + (read ? -1 : 1)));
    try {
      await setNotificationRead(item.id, read);
      broadcastNotificationsUpdated("page");
    } catch {
      setError("未能更新消息状态");
      await load();
    }
  }

  async function archive(item: NotificationItem) {
    setItems((current) =>
      current.filter((candidate) => candidate.id !== item.id),
    );
    if (item.unread) {
      setUnreadCount((current) => Math.max(0, current - 1));
    }
    try {
      await archiveNotification(item.id);
      broadcastNotificationsUpdated("page");
    } catch {
      setError("未能清除消息");
      await load();
    }
  }

  function open(item: NotificationItem) {
    if (!item.unread) return;
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, unread: false } : candidate,
      ),
    );
    setUnreadCount((current) => Math.max(0, current - 1));
    void setNotificationRead(item.id, true)
      .then(() => broadcastNotificationsUpdated("page"))
      .catch(() => {
        setError("未能更新消息状态");
      });
  }

  async function markAllRead() {
    if (unreadCount === 0) return;
    try {
      await markAllNotificationsRead();
      setUnreadCount(0);
      setItems((current) =>
        status === "unread"
          ? []
          : current.map((item) => ({ ...item, unread: false })),
      );
      broadcastNotificationsUpdated("page");
    } catch {
      setError("未能将消息全部标为已读");
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(nextCursor);
    } catch {
      setError("更多消息加载失败");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className={styles.workspace}>
      <FeedbackNotice notice={errorNotice} tone="error" />
      <header className={styles.toolbar}>
        <div>
          <strong>消息</strong>
          <span>
            {unreadCount > 0 ? `${unreadCount} 条未读` : "没有未读消息"}
          </span>
        </div>
        <div className={styles.tools}>
          <div className={styles.segments} aria-label="消息状态">
            {(["all", "unread"] as const).map((value) => (
              <button
                aria-pressed={status === value}
                key={value}
                onClick={() => setStatus(value)}
                type="button"
              >
                {value === "all" ? "全部" : "未读"}
              </button>
            ))}
          </div>
          <label className={styles.category}>
            <span className="sr-only">消息类型</span>
            <select
              onChange={(event) =>
                setCategory(event.target.value as CategoryFilter)
              }
              value={category}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.markAll}
            disabled={unreadCount === 0}
            onClick={() => void markAllRead()}
            type="button"
          >
            全部已读
          </button>
        </div>
      </header>

      <div className={styles.feed}>
        {loading ? (
          <div aria-label="正在加载消息" className={styles.skeleton}>
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        ) : items.length > 0 ? (
          <NotificationList
            items={items}
            onArchive={(item) => void archive(item)}
            onOpen={open}
            onToggleRead={(item) => void toggleRead(item)}
          />
        ) : (
          <div className={styles.empty}>
            <strong>{status === "unread" ? "没有未读消息" : "暂无消息"}</strong>
            <span>
              {status === "unread"
                ? "需要你关注的新动态会显示在这里。"
                : "课堂、练习、反馈和论坛动态会显示在这里。"}
            </span>
          </div>
        )}
      </div>

      {nextCursor ? (
        <button
          className={styles.loadMore}
          disabled={loadingMore}
          onClick={() => void loadMore()}
          type="button"
        >
          {loadingMore ? "正在加载…" : "加载更多"}
        </button>
      ) : null}
    </section>
  );
}
