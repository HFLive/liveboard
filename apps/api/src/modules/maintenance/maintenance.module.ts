import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceModeGuard } from "./maintenance.guard";
import { MaintenanceService } from "./maintenance.service";

@Module({
  imports: [PrismaModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceModeGuard],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
