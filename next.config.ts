import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" makes `next build` emit a self-contained server in
  // .next/standalone with only the node_modules it actually imports —
  // that's what the Dockerfile's runtime stage copies in.
  output: "standalone",
};

export default nextConfig;
