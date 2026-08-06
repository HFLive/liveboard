import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ActiveUserGuard } from "./common/active-user.guard";
import { AiModule } from "./modules/ai/ai.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ExercisesModule } from "./modules/exercises/exercises.module";
import { FilesModule } from "./modules/files/files.module";
import { ForumModule } from "./modules/forum/forum.module";
import { HealthModule } from "./modules/health/health.module";
import { PermissionsModule } from "./modules/permissions/permissions.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { ServerStatusModule } from "./modules/server-status/server-status.module";
import { StorageModule } from "./modules/storage/storage.module";
import { UsersModule } from "./modules/users/users.module";
import { TeachingModule } from "./modules/teaching/teaching.module";
import { ClassroomsModule } from "./modules/classrooms/classrooms.module";
import { BadgesModule } from "./modules/badges/badges.module";
import { MaintenanceModule } from "./modules/maintenance/maintenance.module";
import { MaintenanceModeGuard } from "./modules/maintenance/maintenance.guard";
import { MigrationModule } from "./modules/migration/migration.module";
import { ApiTokensModule } from "./modules/api-tokens/api-tokens.module";
import { McpModule } from "./modules/mcp/mcp.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PermissionsModule,
    FilesModule,
    ExercisesModule,
    ForumModule,
    SettingsModule,
    ServerStatusModule,
    StorageModule,
    AiModule,
    NotificationsModule,
    ClassroomsModule,
    TeachingModule,
    BadgesModule,
    MaintenanceModule,
    MigrationModule,
    ApiTokensModule,
    McpModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ActiveUserGuard },
    // 维护模式守卫必须排在 ActiveUserGuard 之后，才能读取注入的 currentUserId。
    { provide: APP_GUARD, useClass: MaintenanceModeGuard },
  ],
})
export class AppModule {}
