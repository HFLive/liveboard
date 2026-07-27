import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginRateLimitService } from "./login-rate-limit.service";

@Module({
  imports: [StorageModule],
  controllers: [AuthController],
  providers: [AuthService, LoginRateLimitService],
  exports: [AuthService],
})
export class AuthModule {}
