import { Body, Controller, Get, Post } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { Public } from "../../common/public.decorator";
import {
  MaintenanceService,
  type MaintenanceState,
} from "./maintenance.service";

class SetMaintenanceDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

@Controller()
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  /** 公开只读状态，供前端横幅与登录页展示。 */
  @Get("maintenance/status")
  @Public()
  async status() {
    try {
      const state: MaintenanceState = await this.maintenance.getState();
      return { enabled: state.enabled, reason: state.reason };
    } catch {
      // 状态文件不可读：宁可显示"维护中"也不隐藏保护状态。
      return { enabled: true, reason: null };
    }
  }

  @Get("admin/maintenance")
  async getMaintenance(@CurrentUserId() userId: string | null) {
    return {
      maintenance: await this.maintenance.getStateForAdmin(userId),
    };
  }

  @Post("admin/maintenance")
  async setMaintenance(
    @CurrentUserId() userId: string | null,
    @Body() body: SetMaintenanceDto,
  ) {
    return {
      maintenance: await this.maintenance.setEnabled(
        userId,
        body.enabled,
        body.reason,
      ),
    };
  }
}
