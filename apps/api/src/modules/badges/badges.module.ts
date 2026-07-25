import { Module } from "@nestjs/common";
import { AdminBadgesController, BadgesController } from "./badges.controller";
import { BadgesService } from "./badges.service";

@Module({
  controllers: [BadgesController, AdminBadgesController],
  providers: [BadgesService],
})
export class BadgesModule {}
