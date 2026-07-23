import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ServerMetricsCollector } from "./server-metrics.collector";
import { ServerStatusController } from "./server-status.controller";
import { ServerStatusService } from "./server-status.service";

@Module({
  imports: [PrismaModule],
  controllers: [ServerStatusController],
  providers: [ServerMetricsCollector, ServerStatusService],
})
export class ServerStatusModule {}
