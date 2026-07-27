import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { StorageModule } from "../storage/storage.module";
import { SettingsController } from "./settings.controller";
import { HttpsAgentClient } from "./https-agent.client";
import { SettingsService } from "./settings.service";

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [SettingsController],
  providers: [SettingsService, HttpsAgentClient],
})
export class SettingsModule {}
