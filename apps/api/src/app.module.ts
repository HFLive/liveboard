import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ActiveUserGuard } from "./common/active-user.guard";
import { AiModule } from "./modules/ai/ai.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ExercisesModule } from "./modules/exercises/exercises.module";
import { FilesModule } from "./modules/files/files.module";
import { ForumModule } from "./modules/forum/forum.module";
import { HealthModule } from "./modules/health/health.module";
import { PermissionsModule } from "./modules/permissions/permissions.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { UsersModule } from "./modules/users/users.module";
import { TeachingModule } from "./modules/teaching/teaching.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PermissionsModule,
    FilesModule,
    ExercisesModule,
    ForumModule,
    SettingsModule,
    AiModule,
    TeachingModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ActiveUserGuard }],
})
export class AppModule {}
