import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { StorageModule } from "../storage/storage.module";
import { AssetsService } from "./assets.service";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";

@Module({
  imports: [PermissionsModule, StorageModule],
  controllers: [FilesController],
  providers: [AssetsService, FilesService],
  exports: [AssetsService],
})
export class FilesModule {}
