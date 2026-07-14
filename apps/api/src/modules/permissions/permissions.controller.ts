import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { isPermissionLevel } from "@liveboard/shared";
import type { PermissionLevel, PermissionTargetType } from "@liveboard/shared";
import { IsIn, IsString } from "class-validator";
import { CurrentUserId } from "../../common/current-user-id.decorator";
import { Public } from "../../common/public.decorator";
import { PermissionsService } from "./permissions.service";

class UpsertPermissionDto {
  @IsIn(["workspace", "folder", "file"])
  targetType!: PermissionTargetType;

  @IsString()
  targetId!: string;

  @IsString()
  groupId!: string;

  @IsIn(["owner", "editor", "lecturer", "viewer", "no_access"])
  level!: PermissionLevel;
}

@Controller("permissions")
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get("workspace-default")
  async workspaceDefault(@CurrentUserId() actorUserId: string | null) {
    return {
      workspace:
        await this.permissionsService.getDefaultWorkspaceForPermissions(
          actorUserId,
        ),
    };
  }

  @Get("effective")
  @Public()
  effective(
    @Query("inherited") inherited?: string,
    @Query("explicit") explicit?: string,
  ) {
    const inheritedLevel: PermissionLevel | null =
      inherited && isPermissionLevel(inherited) ? inherited : null;
    const explicitLevel: PermissionLevel | null =
      explicit && isPermissionLevel(explicit) ? explicit : null;

    return this.permissionsService.getEffectivePermission(
      inheritedLevel,
      explicitLevel,
    );
  }

  @Get()
  async list(
    @CurrentUserId() actorUserId: string | null,
    @Query("targetType") targetType: PermissionTargetType,
    @Query("targetId") targetId: string,
  ) {
    return this.permissionsService.listGrants(
      actorUserId,
      targetType,
      targetId,
    );
  }

  @Post()
  async upsert(
    @CurrentUserId() actorUserId: string | null,
    @Body() body: UpsertPermissionDto,
  ) {
    return {
      grant: await this.permissionsService.upsertGrant(actorUserId, body),
    };
  }

  @Delete(":id")
  async remove(
    @CurrentUserId() actorUserId: string | null,
    @Param("id") grantId: string,
  ) {
    return this.permissionsService.deleteGrant(actorUserId, grantId);
  }
}
