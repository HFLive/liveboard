import { Global, Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { StorageModule } from "../storage/storage.module";
import { HfliveCronController } from "./hflive-cron.controller";
import {
  HfliveAdminController,
  HfliveAuthController,
  HfliveWebhookController,
} from "./hflive-auth.controller";
import { HfliveAuthConfig } from "./hflive-auth.config";
import { HfliveDirectoryService } from "./directory.service";
import { HfliveAuthService } from "./hflive-auth.service";
import { OidcTransactionService } from "./oidc-transaction.service";

@Global()
@Module({
  imports: [StorageModule, AiModule],
  controllers: [
    HfliveAuthController,
    HfliveAdminController,
    HfliveWebhookController,
    HfliveCronController,
  ],
  providers: [
    HfliveAuthConfig,
    HfliveDirectoryService,
    OidcTransactionService,
    HfliveAuthService,
  ],
  exports: [HfliveAuthConfig, HfliveAuthService],
})
export class HfliveAuthModule {}
