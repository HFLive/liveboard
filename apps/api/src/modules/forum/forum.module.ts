import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { ForumController } from "./forum.controller";
import { ForumService } from "./forum.service";
import { PermissionsModule } from "../permissions/permissions.module";

@Module({
  imports: [FilesModule, PermissionsModule],
  controllers: [ForumController],
  providers: [ForumService],
})
export class ForumModule {}
