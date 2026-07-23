import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { ServerStatusService } from "./server-status.service";

@Controller("admin/server-status")
export class ServerStatusController {
  constructor(private readonly serverStatus: ServerStatusService) {}

  @Get()
  status(
    @CurrentUserId() userId: string | null,
    @Query("hours") hours?: string,
  ) {
    return this.serverStatus.getStatus(userId, Number(hours ?? 24));
  }
}
