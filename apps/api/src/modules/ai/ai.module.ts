import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiSecretService } from "./ai-secret.service";
import { AiRateLimitService } from "./ai-rate-limit.service";
import { AiRagService } from "./ai-rag.service";
import { AiRagController } from "./ai-rag.controller";

@Module({
  imports: [PermissionsModule],
  controllers: [AiController, AiRagController],
  providers: [AiService, AiSecretService, AiRateLimitService, AiRagService],
  exports: [AiSecretService, AiRagService],
})
export class AiModule {}
