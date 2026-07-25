import { Module } from "@nestjs/common";
import {
  UserTagsController,
  UsersController,
  VisibilityUsersController,
} from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  controllers: [UsersController, VisibilityUsersController, UserTagsController],
  providers: [UsersService],
})
export class UsersModule {}
