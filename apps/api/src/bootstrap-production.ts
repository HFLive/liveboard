import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { DEFAULT_FORUM_CATEGORIES } from "./modules/forum/forum-defaults";

export type ProductionBootstrapResult =
  { created: false } | { created: true; username: string; password: string };

export async function bootstrapProduction(
  prisma: PrismaClient,
  password = randomBytes(18).toString("base64url"),
  hashPassword: (value: string) => Promise<string> = (value) =>
    argon2.hash(value),
): Promise<ProductionBootstrapResult> {
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { systemRole: "super_admin", status: "active" },
    select: { id: true },
  });

  if (existingSuperAdmin) {
    return { created: false };
  }

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    throw new Error(
      "数据库中已有用户，但没有正常状态的最高管理员；已停止自动初始化。",
    );
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (transaction) => {
    await transaction.user.create({
      data: {
        username: "admin",
        displayName: "管理员",
        passwordHash,
        systemRole: "super_admin",
        status: "active",
      },
    });

    const workspace = await transaction.workspace.upsert({
      where: { slug: "default" },
      update: {},
      create: {
        name: "LiveBoard",
        slug: "default",
        timeZone: "Asia/Shanghai",
      },
    });

    await transaction.forumCategory.createMany({
      data: DEFAULT_FORUM_CATEGORIES.map((category) => ({
        workspaceId: workspace.id,
        ...category,
      })),
      skipDuplicates: true,
    });
  });

  return { created: true, username: "admin", password };
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const result = await bootstrapProduction(prisma);

    if (!result.created) {
      console.log("系统已经初始化，跳过首次管理员创建。");
      return;
    }

    console.log("首次管理员已创建，请保存以下凭据并立即修改密码：");
    console.log(`账号：${result.username}`);
    console.log(`密码：${result.password}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
