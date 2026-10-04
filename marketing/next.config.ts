import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Its own project (Vercel Root Directory = marketing): pin the root so Next does not pick the repo root lockfile.
const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;
