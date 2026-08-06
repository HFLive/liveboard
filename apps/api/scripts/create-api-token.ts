import { ApiTokenService } from "../src/modules/api-tokens/api-token.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";

/**
 * 生成个人访问令牌（PAT），供 MCP 等外部客户端以用户身份调用 API。
 * 用法：
 *   pnpm --filter @liveboard/api api-token:create -- --user <username> --name <名称> [--expiresAt <ISO 时间>]
 * 令牌明文只打印一次，请立即保存；数据库只存 SHA-256 哈希。
 */

interface CliArgs {
  user: string;
  name: string;
  expiresAt?: Date;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { user: "", name: "" };
  for (let i = 0; i < argv.length; i++) {
    // pnpm 会把脚本分隔符 `--` 原样透传进来，直接跳过
    if (argv[i] === "--") continue;
    const value = argv[i + 1];
    switch (argv[i]) {
      case "--user":
      case "-u":
        args.user = value ?? "";
        i++;
        break;
      case "--name":
        args.name = value ?? "";
        i++;
        break;
      case "--expiresAt":
        args.expiresAt = value ? new Date(value) : undefined;
        i++;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`未知参数：${argv[i]}`);
    }
  }
  if (!args.user) throw new Error("缺少 --user <username>");
  if (!args.name) throw new Error("缺少 --name <名称>");
  if (args.expiresAt && Number.isNaN(args.expiresAt.getTime())) {
    throw new Error(`--expiresAt 不是有效时间：${argv.join(" ")}`);
  }
  return args;
}

function printHelp() {
  console.log(`用法：pnpm --filter @liveboard/api api-token:create -- --user <username> --name <名称> [--expiresAt <ISO 时间>]

  --user <username>      令牌归属用户（必须存在且已启用）
  --name <名称>          令牌名称（建议按客户端命名，便于审计）
  --expiresAt <ISO 时间> 可选过期时间，如 2027-01-01T00:00:00Z`);
}

async function main() {
  const { user: username, name, expiresAt } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaService();
  const apiTokens = new ApiTokenService(prisma);
  try {
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, status: true },
    });
    if (!user) throw new Error(`用户「${username}」不存在`);
    if (user.status !== "active") {
      throw new Error(`用户「${username}」未启用，无法生成令牌`);
    }

    const result = await apiTokens.createToken({
      userId: user.id,
      name,
      expiresAt,
    });

    console.log("===== API Token 已生成（明文仅显示一次，请立即保存）=====");
    console.log(`名称: ${name}`);
    console.log(`用户: ${username} (${user.id})`);
    console.log(`令牌: ${result.token}`);
    if (expiresAt) console.log(`过期: ${expiresAt.toISOString()}`);
    console.log("=======================================================");
    console.log("MCP 配置示例（Authorization 头）:");
    console.log(`  Authorization: Bearer ${result.token}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
