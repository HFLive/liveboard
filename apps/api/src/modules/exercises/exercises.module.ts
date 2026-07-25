import { Module } from "@nestjs/common";
import { ExercisesController } from "./exercises.controller";
import { ExercisesService } from "./exercises.service";
import { ClassroomsModule } from "../classrooms/classrooms.module";

@Module({
  imports: [ClassroomsModule],
  controllers: [ExercisesController],
  providers: [ExercisesService],
})
export class ExercisesModule {}
