import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MigrationController } from "./migration.controller";
import { MigrationService } from "./migration.service";

@Module({
  imports: [PrismaModule],
  controllers: [MigrationController],
  providers: [MigrationService],
  exports: [MigrationService],
})
export class MigrationModule {}
