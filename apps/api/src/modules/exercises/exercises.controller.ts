import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import {
  CreateExerciseSetDto,
  GradeSubmissionDto,
  SubmitExerciseDto,
} from "./exercises.dto";
import { ExercisesService } from "./exercises.service";

@Controller()
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Post("exercise-sets")
  async create(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateExerciseSetDto,
  ) {
    return {
      exerciseSet: await this.exercisesService.createExerciseSet(userId, body),
    };
  }

  @Get("exercise-sets")
  async list(@CurrentUserId() userId: string | null) {
    return {
      exerciseSets: await this.exercisesService.listExerciseSets(userId),
    };
  }

  @Get("exercise-sets/:id")
  async get(@CurrentUserId() userId: string | null, @Param("id") id: string) {
    return {
      exerciseSet: await this.exercisesService.getExerciseSet(userId, id),
    };
  }

  @Post("exercise-sets/:id/submit")
  async submit(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
    @Body() body: SubmitExerciseDto,
  ) {
    return {
      submission: await this.exercisesService.submitExercise(userId, id, body),
    };
  }

  @Get("exercise-sets/:id/submissions")
  async submissions(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return {
      submissions: await this.exercisesService.listSubmissions(userId, id),
    };
  }

  @Get("exercise-sets/:id/my-submissions")
  async mySubmissions(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return {
      submissions: await this.exercisesService.listMySubmissions(userId, id),
    };
  }

  @Patch("submissions/:id/grade")
  async grade(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
    @Body() body: GradeSubmissionDto,
  ) {
    return {
      submission: await this.exercisesService.gradeSubmission(userId, id, body),
    };
  }
}
