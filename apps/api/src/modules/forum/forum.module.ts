import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { ForumController } from "./forum.controller";
import { ForumService } from "./forum.service";

@Module({
  imports: [FilesModule],
  controllers: [ForumController],
  providers: [ForumService],
})
export class ForumModule {}
