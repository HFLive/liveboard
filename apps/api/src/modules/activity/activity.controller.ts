import { Controller, Get, Post } from "@nestjs/common";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { ActivityService } from "./activity.service";

@Controller("activity")
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list(@CurrentUserId() userId: string | null) {
    return this.activity.list(userId);
  }

  @Post("read")
  markRead(@CurrentUserId() userId: string | null) {
    return this.activity.markRead(userId);
  }
}
