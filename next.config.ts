import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone) for a lean Docker image.
  output: "standalone",
  // Avoid the native sharp dependency in the container; avatars are tiny and
  // mostly initials, so on-the-fly image optimization isn't worth the weight.
  images: { unoptimized: true },
};

export default nextConfig;
