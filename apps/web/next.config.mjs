import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import('next').NextConfig} */
const createNextConfig = (phase) => ({
  distDir:
    process.env.NEXT_DIST_DIR ??
    (phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next"),
  reactStrictMode: true,
  transpilePackages: ["@liveboard/shared"],
  typedRoutes: true,
});

export default createNextConfig;
