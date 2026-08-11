import { Global, Module } from "@nestjs/common";
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
  controllers: [
    HfliveAuthController,
    HfliveAdminController,
    HfliveWebhookController,
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
