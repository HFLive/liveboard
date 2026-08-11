const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const servicePath = resolve(
  __dirname,
  "../dist/modules/hflive-auth/hflive-auth.service.js",
);
const service = readFileSync(servicePath, "utf8");

if (!service.includes('import("openid-client")')) {
  throw new Error(
    "HFLive OIDC build must retain a traceable native import of openid-client",
  );
}

if (service.includes('require("openid-client")')) {
  throw new Error(
    "HFLive OIDC build must not compile the ESM-only openid-client package to require()",
  );
}

console.log("HFLive OIDC bundle import verified");
