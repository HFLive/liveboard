import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { AssetsService } from "./assets.service";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";

@Module({
  imports: [PermissionsModule],
  controllers: [FilesController],
  providers: [AssetsService, FilesService],
  exports: [AssetsService],
})
export class FilesModule {}
