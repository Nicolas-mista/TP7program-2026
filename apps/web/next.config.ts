import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(dir, "../../"),
  transpilePackages: ["@rutasur/shared"],
  serverExternalPackages: ["mongodb", "kafkajs"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
