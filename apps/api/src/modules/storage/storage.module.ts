import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { StorageCronController } from "./storage-cron.controller";
import { StorageController } from "./storage.controller";
import { StorageService } from "./storage.service";

@Module({
  imports: [AiModule],
  controllers: [StorageController, StorageCronController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
