import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { AiIndexRefreshInterceptor } from "../ai/ai-index-refresh.interceptor";
import { PermissionsModule } from "../permissions/permissions.module";
import { StorageModule } from "../storage/storage.module";
import { AssetsService } from "./assets.service";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";

@Module({
  imports: [PermissionsModule, StorageModule, AiModule],
  controllers: [FilesController],
  providers: [AssetsService, FilesService, AiIndexRefreshInterceptor],
  exports: [AssetsService, FilesService],
})
export class FilesModule {}
