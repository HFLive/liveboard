import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { StorageCronController } from "./storage-cron.controller";
import { StorageController } from "./storage.controller";
import { MultipartUploadController } from "./multipart-upload.controller";
import { StorageService } from "./storage.service";

@Module({
  imports: [AiModule],
  controllers: [
    StorageController,
    StorageCronController,
    MultipartUploadController,
  ],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
