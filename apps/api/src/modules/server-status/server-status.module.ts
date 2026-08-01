import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { StorageModule } from "../storage/storage.module";
import { ServerMetricsCollector } from "./server-metrics.collector";
import { ServerStatusController } from "./server-status.controller";
import { ServerStatusService } from "./server-status.service";

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [ServerStatusController],
  providers: [ServerMetricsCollector, ServerStatusService],
})
export class ServerStatusModule {}
