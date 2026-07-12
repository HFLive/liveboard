import { Module } from "@nestjs/common";
import { PermissionsModule } from "../permissions/permissions.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

@Module({
  imports: [PermissionsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
