import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { isSuperAdmin } from "@liveboard/shared";
import { PrismaService } from "../modules/prisma/prisma.service";

/**
 * 校验当前用户为正常状态的最高管理员。供管理端点复用；会话注入由
 * ActiveUserGuard 完成，这里只读取 currentUserId 对应的用户。
 */
export async function requireSuperAdmin(
  prisma: PrismaService,
  userId: string | null,
) {
  if (!userId) throw new UnauthorizedException("缺少登录会话");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, systemRole: true, status: true },
  });
  if (!user || !isSuperAdmin(user.systemRole) || user.status !== "active") {
    throw new ForbiddenException("只有最高管理员可以执行此操作");
  }
  return user;
}
