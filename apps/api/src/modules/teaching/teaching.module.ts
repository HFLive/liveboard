import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { TeachingController } from "./teaching.controller";
import { TeachingService } from "./teaching.service";

@Module({
  imports: [PermissionsModule],
  controllers: [TeachingController],
  providers: [TeachingService],
})
export class TeachingModule {}
