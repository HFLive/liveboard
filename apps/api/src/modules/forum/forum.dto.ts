import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";
import type { ForumThreadStatus } from "@liveboard/shared";
import { ValidateNested } from "class-validator";

export class ForumRelatedResourceDto {
  @IsIn(["document", "teaching", "exercise"])
  type!: "document" | "teaching" | "exercise";

  @IsString()
  id!: string;
}

export class CreateForumThreadDto {
  @IsString()
  categoryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ForumRelatedResourceDto)
  relatedResources?: ForumRelatedResourceDto[];
}

export class CreateForumPostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;
}

export class UpdateForumThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(["open", "locked"])
  status?: ForumThreadStatus;
}

export class UpdateForumPostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}

export class CreateForumCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateForumCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
