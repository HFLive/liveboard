"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  BellRing,
  Check,
  ClipboardCheck,
  FileCheck,
  KeyRound,
  Megaphone,
  MessageCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { NotificationCategory, NotificationItem } from "@liveboard/shared";
import { apiResourceUrl } from "@/lib/api";
import { formatRelativeTime } from "@/lib/labels";
import styles from "./NotificationList.module.css";

const CATEGORY_META: Record<
  NotificationCategory,
  { label: string; Icon: typeof BellRing }
> = {
  task: { label: "待处理", Icon: ClipboardCheck },
  classroom: { label: "课堂", Icon: Megaphone },
  feedback: { label: "反馈", Icon: FileCheck },
  interaction: { label: "互动", Icon: MessageCircle },
  permission: { label: "权限", Icon: KeyRound },
  system: { label: "系统", Icon: BellRing },
};

export function NotificationList({
  items,
  compact = false,
  onArchive,
  onOpen,
  onToggleRead,
}: {
  items: NotificationItem[];
  compact?: boolean;
  onArchive: (item: NotificationItem) => void;
  onOpen: (item: NotificationItem) => void;
  onToggleRead: (item: NotificationItem) => void;
}) {
  return (
    <div className={compact ? `${styles.list} ${styles.compact}` : styles.list}>
      {items.map((item) => {
        const { Icon, label } = CATEGORY_META[item.category];
        return (
          <article
            className={`${styles.item}${item.unread ? ` ${styles.unread}` : ""}`}
            key={item.id}
          >
            <Link
              className={styles.link}
              href={item.href as Route}
              onClick={() => onOpen(item)}
            >
              <span className={styles.leading} aria-hidden="true">
                {item.actor?.avatarUrl ? (
                  <img alt="" src={apiResourceUrl(item.actor.avatarUrl)} />
                ) : (
                  <Icon />
                )}
              </span>
              <span className={styles.content}>
                <span className={styles.titleRow}>
                  <strong>{item.title}</strong>
                  <time dateTime={item.occurredAt}>
                    {formatRelativeTime(item.occurredAt)}
                  </time>
                </span>
                <span className={styles.detail}>{item.detail}</span>
                <span className={styles.context}>
                  {item.classroomName ?? label}
                </span>
              </span>
            </Link>
            <span className={styles.actions}>
              <button
                aria-label={
                  item.unread
                    ? `将“${item.title}”标为已读`
                    : `将“${item.title}”标为未读`
                }
                onClick={() => onToggleRead(item)}
                title={item.unread ? "标为已读" : "标为未读"}
                type="button"
              >
                {item.unread ? (
                  <Check aria-hidden="true" />
                ) : (
                  <RotateCcw aria-hidden="true" />
                )}
              </button>
              <button
                aria-label={`删除消息“${item.title}”`}
                onClick={() => onArchive(item)}
                title="删除"
                type="button"
              >
                <Trash2 aria-hidden="true" />
              </button>
            </span>
          </article>
        );
      })}
    </div>
  );
}
