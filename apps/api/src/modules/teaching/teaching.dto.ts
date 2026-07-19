import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import type { TeachingDeckItemType } from "@liveboard/shared";

export class TeachingDeckItemDto {
  @IsIn(["content_block", "exercise"])
  type!: TeachingDeckItemType;

  @ValidateIf((item: TeachingDeckItemDto) => item.type === "content_block")
  @IsString()
  sourceBlockId?: string;

  @ValidateIf((item: TeachingDeckItemDto) => item.type === "exercise")
  @IsString()
  exerciseSetId?: string;

  @IsOptional()
  @IsIn(["fit", "fill", "original"])
  imageFit?: "fit" | "fill" | "original";
}

export class CreateTeachingDeckDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeachingDeckItemDto)
  items!: TeachingDeckItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  visibleUserIds?: string[];
}

export class UpdateTeachingDeckDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeachingDeckItemDto)
  items?: TeachingDeckItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  visibleUserIds?: string[];
}
