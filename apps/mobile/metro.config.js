const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.extraNodeModules = {
  "@liveboard/shared": path.resolve(workspaceRoot, "packages/shared/src"),
};

const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@liveboard/shared") {
    return {
      filePath: path.resolve(workspaceRoot, "packages/shared/src/index.ts"),
      type: "sourceFile",
    };
  }
  if (moduleName === "@liveboard/shared/bilibili") {
    return {
      filePath: path.resolve(workspaceRoot, "packages/shared/src/bilibili.ts"),
      type: "sourceFile",
    };
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
