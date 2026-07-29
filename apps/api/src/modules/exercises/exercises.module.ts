import { Module } from "@nestjs/common";
import { ExercisesController } from "./exercises.controller";
import { ExercisesService } from "./exercises.service";
import { ClassroomsModule } from "../classrooms/classrooms.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [ClassroomsModule, NotificationsModule],
  controllers: [ExercisesController],
  providers: [ExercisesService],
})
export class ExercisesModule {}
