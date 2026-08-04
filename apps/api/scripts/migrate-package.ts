import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * 迁移包来源解析（导入/校验共用）：`.tar` 解压到数据目录下的临时目录，
 * 目录直接使用。返回包目录（含 manifest.json）与清理函数。
 *
 * 解压前先校验 tar 成员：拒绝绝对路径、`..` 穿越、符号/硬链接与设备文件成员；
 * 解压后再全量遍历（目录源也走同一校验）拒绝符号链接与逃出解压目录的成员，
 * 防止恶意包借 symlink 读取容器内 .env 之类的敏感文件。
 */
export async function resolvePackageDir(
  source: string,
  dataDir: string,
  tempKey: string,
): Promise<{ packageDir: string; cleanup: () => Promise<void> }> {
  const sourceStat = await stat(source);
  if (sourceStat.isDirectory()) {
    await assertNoUnsafeEntries(source);
    return { packageDir: source, cleanup: async () => undefined };
  }

  const tempRoot = path.join(dataDir, "incoming", `.tmp-${tempKey}`);
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  assertSafeTarMembers(source);
  const result = spawnSync("tar", ["-xf", source, "-C", tempRoot], {
    stdio: "inherit",
  });
  if (result.error || (result.status ?? 1) !== 0) {
    throw new Error(
      `解压迁移包失败：${result.error?.message ?? `exit=${result.status}`}`,
    );
  }
  await assertNoUnsafeEntries(tempRoot);
  const entries = await readdir(tempRoot);
  const dirs = entries.filter((name) =>
    statSync(path.join(tempRoot, name)).isDirectory(),
  );
  if (dirs.length !== 1) {
    throw new Error("迁移包 tar 内应恰好包含一个包目录");
  }
  return {
    packageDir: path.join(tempRoot, dirs[0]!),
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  };
}

/**
 * 解压前校验 tar 成员（fail-closed）：拒绝绝对路径、`..` 穿越，以及符号链接、
 * 硬链接、设备/管道成员。BusyBox/GNU tar 默认都会保留 symlink，不能指望 tar
 * 自身防穿越，必须在解压前按成员清单拒绝。
 */
function assertSafeTarMembers(source: string): void {
  // 对象数量多的包成员可达数百万行，maxBuffer 放宽到 256MB（约两三百万成员），
  // 避免 ENOBUFS 误拒合法大包；超出视为不信任包 fail-closed。
  const names = spawnSync("tar", ["-tf", source], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (names.error || (names.status ?? 1) !== 0) {
    throw new Error(
      `读取迁移包成员失败：${names.error?.message ?? `exit=${names.status}`}`,
    );
  }
  for (const raw of (names.stdout ?? "").split("\n")) {
    const name = raw.trim().replace(/\/+$/, "");
    if (!name || name === ".") continue;
    if (
      path.isAbsolute(name) ||
      name === ".." ||
      name.startsWith("../") ||
      name.includes("/../")
    ) {
      throw new Error(`迁移包成员路径不合法，拒绝解压：${name}`);
    }
  }

  // `tar -tvf` 每行首字符为成员类型：`-` 普通文件 / `d` 目录 / `l` 符号链接 /
  // `h` 硬链接 / `p` 管道 / `b|c` 设备。存在链接或设备成员即拒绝。
  const verbose = spawnSync("tar", ["-tvf", source], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (verbose.error || (verbose.status ?? 1) !== 0) {
    throw new Error(
      `读取迁移包成员失败：${verbose.error?.message ?? `exit=${verbose.status}`}`,
    );
  }
  for (const raw of (verbose.stdout ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const type = line.charAt(0);
    if (
      type === "l" ||
      type === "h" ||
      type === "p" ||
      type === "b" ||
      type === "c"
    ) {
      throw new Error("迁移包含非常规成员（链接/设备文件），拒绝解压");
    }
  }
}

/** 解压后全量遍历校验：根目录与所有成员无符号链接、无逃出解压目录的路径。 */
async function assertNoUnsafeEntries(root: string): Promise<void> {
  const rootResolved = path.resolve(root);
  if ((await lstat(rootResolved)).isSymbolicLink()) {
    throw new Error("迁移包目录本身是符号链接，拒绝使用");
  }
  const stack: string[] = [rootResolved];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const resolved = path.resolve(full);
      if (
        resolved !== rootResolved &&
        !resolved.startsWith(rootResolved + path.sep)
      ) {
        throw new Error(
          `迁移包成员逃出解压目录，拒绝使用：${path.relative(root, full)}`,
        );
      }
      if (entry.isSymbolicLink()) {
        throw new Error(
          `迁移包含符号链接成员，拒绝使用：${path.relative(root, full)}`,
        );
      }
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (!entry.isFile()) {
        throw new Error(
          `迁移包含非常规文件成员，拒绝使用：${path.relative(root, full)}`,
        );
      }
    }
  }
}
