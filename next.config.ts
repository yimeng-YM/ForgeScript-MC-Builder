import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "class-variance-authority",
    "clsx",
    "tailwind-merge",
  ],
};

export default nextConfig;
