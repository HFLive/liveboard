import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import {
  PermissionGroupLookupController,
  PermissionGroupsController,
  UsersController,
} from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [PermissionsModule],
  controllers: [
    UsersController,
    PermissionGroupsController,
    PermissionGroupLookupController,
  ],
  providers: [UsersService],
})
export class UsersModule {}
