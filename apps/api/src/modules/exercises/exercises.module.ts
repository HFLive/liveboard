import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { ExercisesController } from "./exercises.controller";
import { ExercisesService } from "./exercises.service";

@Module({
  imports: [PermissionsModule],
  controllers: [ExercisesController],
  providers: [ExercisesService],
})
export class ExercisesModule {}
