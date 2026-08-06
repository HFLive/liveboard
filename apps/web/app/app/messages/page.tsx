import { Suspense } from "react";
import { NotificationsClient, NotificationsSkeleton } from "./NotificationsClient";

export default function MessagesPage() {
  return (
    <Suspense fallback={<NotificationsSkeleton />}>
      <NotificationsClient />
    </Suspense>
  );
}
