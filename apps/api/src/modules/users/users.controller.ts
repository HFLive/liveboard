import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import type { PermissionTargetType, SystemRole } from "@liveboard/shared";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { UsersService } from "./users.service";

class CreateUserDto {
  @IsString()
  username!: string;

  @IsString()
  displayName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(["admin", "member"])
  systemRole!: SystemRole;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsIn(["admin", "member"])
  systemRole?: SystemRole;

  @IsOptional()
  @IsIn(["active", "disabled"])
  status?: "active" | "disabled";

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  storageQuotaBytes?: number;
}

class ImportUserRowDto {
  @IsString()
  username!: string;

  @IsString()
  displayName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(["admin", "member"])
  systemRole!: SystemRole;
}

class ImportUsersDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ImportUserRowDto)
  users!: ImportUserRowDto[];
}

class CreatePermissionGroupDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class UpdatePermissionGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class AddPermissionGroupMemberDto {
  @IsString()
  userId!: string;
}

@Controller("admin/users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@CurrentUserId() actorUserId: string | null) {
    return { users: await this.usersService.listUsers(actorUserId) };
  }

  @Post()
  async create(
    @CurrentUserId() actorUserId: string | null,
    @Body() body: CreateUserDto,
  ) {
    return { user: await this.usersService.createUser(actorUserId, body) };
  }

  @Post("import")
  async importUsers(
    @CurrentUserId() actorUserId: string | null,
    @Body() body: ImportUsersDto,
  ) {
    return {
      result: await this.usersService.importUsers(actorUserId, body.users),
    };
  }

  @Get("storage")
  async storage(@CurrentUserId() actorUserId: string | null) {
    return {
      users: await this.usersService.listUserStorage(actorUserId),
    };
  }

  @Patch(":id")
  async update(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") userId: string,
    @Body() body: UpdateUserDto,
  ) {
    return {
      user: await this.usersService.updateUser(actorUserId, userId, body),
    };
  }
}

@Controller("admin/permission-groups")
export class PermissionGroupsController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@CurrentUserId() actorUserId: string | null) {
    return {
      groups: await this.usersService.listPermissionGroups(actorUserId),
    };
  }

  @Post()
  async create(
    @CurrentUserId() actorUserId: string | null,
    @Body() body: CreatePermissionGroupDto,
  ) {
    return {
      group: await this.usersService.createPermissionGroup(actorUserId, body),
    };
  }

  @Patch(":id")
  async update(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") groupId: string,
    @Body() body: UpdatePermissionGroupDto,
  ) {
    return {
      group: await this.usersService.updatePermissionGroup(
        actorUserId,
        groupId,
        body,
      ),
    };
  }

  @Delete(":id")
  async remove(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") groupId: string,
  ) {
    return this.usersService.deletePermissionGroup(actorUserId, groupId);
  }

  @Post(":id/members")
  async addMember(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") groupId: string,
    @Body() body: AddPermissionGroupMemberDto,
  ) {
    return {
      group: await this.usersService.addPermissionGroupMember(
        actorUserId,
        groupId,
        body.userId,
      ),
    };
  }

  @Delete(":id/members/:userId")
  async removeMember(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") groupId: string,
    @Param("userId") userId: string,
  ) {
    return {
      group: await this.usersService.removePermissionGroupMember(
        actorUserId,
        groupId,
        userId,
      ),
    };
  }
}

@Controller("permission-groups")
export class PermissionGroupLookupController {
  constructor(private readonly usersService: UsersService) {}

  @Get("assignable")
  async assignable(
    @CurrentUserId() actorUserId: string | null,
    @Query("targetType") targetType: PermissionTargetType,
    @Query("targetId") targetId: string,
  ) {
    return {
      groups: await this.usersService.listAssignablePermissionGroups(
        actorUserId,
        targetType,
        targetId,
      ),
    };
  }
}
