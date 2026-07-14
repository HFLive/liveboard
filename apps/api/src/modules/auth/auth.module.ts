import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginRateLimitService } from "./login-rate-limit.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginRateLimitService],
  exports: [AuthService],
})
export class AuthModule {}
