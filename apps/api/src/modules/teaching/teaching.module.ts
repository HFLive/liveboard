import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { ClassroomsModule } from "../classrooms/classrooms.module";
import { TeachingController } from "./teaching.controller";
import { TeachingService } from "./teaching.service";

@Module({
  imports: [PermissionsModule, ClassroomsModule],
  controllers: [TeachingController],
  providers: [TeachingService],
})
export class TeachingModule {}
