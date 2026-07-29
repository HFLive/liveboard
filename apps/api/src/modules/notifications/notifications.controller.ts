import { Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUserId() userId: string | null,
    @Query("status") status?: string,
    @Query("category") category?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.notifications.list(userId, {
      status,
      category,
      cursor,
      limit,
    });
  }

  @Post("read")
  markAllRead(@CurrentUserId() userId: string | null) {
    return this.notifications.markAllRead(userId);
  }

  @Post(":notificationId/read")
  markRead(
    @CurrentUserId() userId: string | null,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notifications.setRead(userId, notificationId, true);
  }

  @Delete(":notificationId/read")
  markUnread(
    @CurrentUserId() userId: string | null,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notifications.setRead(userId, notificationId, false);
  }

  @Delete(":notificationId")
  archive(
    @CurrentUserId() userId: string | null,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notifications.archive(userId, notificationId);
  }
}
