import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";
import { StorageModule } from "../storage/storage.module";
import { BackupController } from "./backup.controller";
import { BackupService } from "./backup.service";
import { BackupVercelExecutor } from "./backup-vercel-executor";

@Module({
  imports: [PrismaModule, RedisModule, StorageModule],
  controllers: [BackupController],
  providers: [BackupService, BackupVercelExecutor],
  exports: [BackupService],
})
export class BackupModule {}
