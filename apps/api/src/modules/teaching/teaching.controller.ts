import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { CreateTeachingDeckDto, UpdateTeachingDeckDto } from "./teaching.dto";
import { TeachingService } from "./teaching.service";

@Controller("teaching-decks")
export class TeachingController {
  constructor(private readonly teachingService: TeachingService) {}

  @Get()
  async list(@CurrentUserId() userId: string | null) {
    return { decks: await this.teachingService.list(userId) };
  }

  @Get(":id")
  async get(@CurrentUserId() userId: string | null, @Param("id") id: string) {
    return { deck: await this.teachingService.get(userId, id) };
  }

  @Post()
  async create(
    @CurrentUserId() userId: string | null,
    @Body() body: CreateTeachingDeckDto,
  ) {
    return { deck: await this.teachingService.create(userId, body) };
  }

  @Patch(":id")
  async update(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
    @Body() body: UpdateTeachingDeckDto,
  ) {
    return { deck: await this.teachingService.update(userId, id, body) };
  }

  @Delete(":id")
  async delete(
    @CurrentUserId() userId: string | null,
    @Param("id") id: string,
  ) {
    return this.teachingService.delete(userId, id);
  }
}
