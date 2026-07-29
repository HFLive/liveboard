export const NOTIFICATIONS_UPDATED_EVENT = "liveboard:notifications-updated";

export type NotificationUpdateSource = "nav" | "page";

export function broadcastNotificationsUpdated(
  source: NotificationUpdateSource,
) {
  window.dispatchEvent(
    new CustomEvent<NotificationUpdateSource>(NOTIFICATIONS_UPDATED_EVENT, {
      detail: source,
    }),
  );
}
