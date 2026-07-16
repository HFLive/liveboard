import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import {
  PermissionGroupLookupController,
  PermissionGroupsController,
  UsersController,
  VisibilityUsersController,
} from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [PermissionsModule],
  controllers: [
    UsersController,
    PermissionGroupsController,
    PermissionGroupLookupController,
    VisibilityUsersController,
  ],
  providers: [UsersService],
})
export class UsersModule {}
