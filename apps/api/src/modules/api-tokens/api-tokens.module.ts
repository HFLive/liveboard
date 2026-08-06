import { Module } from "@nestjs/common";
import { ApiTokenGuard } from "./api-token.guard";
import { ApiTokenService } from "./api-token.service";
import { ApiTokensController } from "./api-tokens.controller";

@Module({
  controllers: [ApiTokensController],
  providers: [ApiTokenService, ApiTokenGuard],
  exports: [ApiTokenService, ApiTokenGuard],
})
export class ApiTokensModule {}
