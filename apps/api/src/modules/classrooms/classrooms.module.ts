import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { ClassroomsController } from "./classrooms.controller";
import { ClassroomsService } from "./classrooms.service";

@Module({
  imports: [StorageModule],
  controllers: [ClassroomsController],
  providers: [ClassroomsService],
  exports: [ClassroomsService],
})
export class ClassroomsModule {}
