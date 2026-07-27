import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import type { SystemRole } from "@liveboard/shared";
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

  @IsIn(["super_admin", "admin", "member"])
  systemRole!: SystemRole;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsIn(["super_admin", "admin", "member"])
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
  storageQuotaBytes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  aiCallLimit?: number | null;
}

class UpdateStorageQuotaDefaultsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  memberAttachmentQuotaBytes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  classroomStorageQuotaBytes?: number | null;
}

class ImportUserRowDto extends CreateUserDto {}

class ImportUsersDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ImportUserRowDto)
  users!: ImportUserRowDto[];
}

class UserTagDto {
  @IsString()
  @MaxLength(32)
  name!: string;
}

class SetUserTagsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  tagIds!: string[];
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
    return { users: await this.usersService.listUserStorage(actorUserId) };
  }

  @Get("storage/quota-defaults")
  async storageQuotaDefaults(@CurrentUserId() actorUserId: string | null) {
    return {
      defaults: await this.usersService.getStorageQuotaDefaults(actorUserId),
    };
  }

  @Patch("storage/quota-defaults")
  async updateStorageQuotaDefaults(
    @CurrentUserId() actorUserId: string | null,
    @Body() body: UpdateStorageQuotaDefaultsDto,
  ) {
    return {
      defaults: await this.usersService.updateStorageQuotaDefaults(
        actorUserId,
        body,
      ),
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

  @Put(":id/tags")
  async setTags(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") userId: string,
    @Body() body: SetUserTagsDto,
  ) {
    return {
      user: await this.usersService.setUserTags(
        actorUserId,
        userId,
        body.tagIds,
      ),
    };
  }
}

@Controller("users")
export class VisibilityUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("visibility-options")
  async list(@CurrentUserId() actorUserId: string | null) {
    const [users, tags] = await Promise.all([
      this.usersService.listVisibilityUsers(actorUserId),
      this.usersService.listVisibleUserTags(actorUserId),
    ]);
    return { users, tags };
  }
}

@Controller("admin/user-tags")
export class UserTagsController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@CurrentUserId() actorUserId: string | null) {
    return { tags: await this.usersService.listUserTags(actorUserId) };
  }

  @Post()
  async create(
    @CurrentUserId() actorUserId: string | null,
    @Body() body: UserTagDto,
  ) {
    return { tag: await this.usersService.createUserTag(actorUserId, body) };
  }

  @Patch(":id")
  async update(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") tagId: string,
    @Body() body: UserTagDto,
  ) {
    return {
      tag: await this.usersService.updateUserTag(actorUserId, tagId, body),
    };
  }

  @Delete(":id")
  async remove(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") tagId: string,
  ) {
    return this.usersService.deleteUserTag(actorUserId, tagId);
  }
}
