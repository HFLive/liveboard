import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { QuestionType } from "@liveboard/shared";

export class CreateQuestionDto {
  @IsIn([
    "single_choice",
    "multiple_choice",
    "true_false",
    "fill_blank",
    "short_answer",
  ])
  type!: QuestionType;

  @IsObject()
  promptJson!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  optionsJson?: unknown;

  @ValidateIf((question: CreateQuestionDto) => question.type !== "short_answer")
  @IsDefined()
  answerJson?: unknown;

  @IsInt()
  @Min(1)
  score!: number;
}

export class CreateExerciseSetDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsDateString()
  openAt?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsBoolean()
  allowMultipleSubmissions?: boolean;

  @IsOptional()
  @IsBoolean()
  showAnswerAfterSubmit?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions!: CreateQuestionDto[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  visibleUserIds?: string[];
}

export class UpdateExerciseVisibilityDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  visibleUserIds!: string[];
}

export class SubmitAnswerDto {
  @IsString()
  questionId!: string;

  @IsOptional()
  answerJson!: unknown;
}

export class SubmitExerciseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers!: SubmitAnswerDto[];
}

export class GradeAnswerDto {
  @IsString()
  answerId!: string;

  @IsInt()
  @Min(0)
  score!: number;

  @IsOptional()
  @IsString()
  feedback?: string;
}

export class GradeSubmissionDto {
  @IsOptional()
  @IsString()
  feedback?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeAnswerDto)
  answers!: GradeAnswerDto[];
}
