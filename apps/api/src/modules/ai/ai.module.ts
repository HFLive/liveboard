import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiSecretService } from "./ai-secret.service";
import { AiRateLimitService } from "./ai-rate-limit.service";

@Module({
  imports: [PermissionsModule],
  controllers: [AiController],
  providers: [AiService, AiSecretService, AiRateLimitService],
})
export class AiModule {}
