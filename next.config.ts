import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // serverComponentsExternalPackages przeniesione do serverExternalPackages w Next 15
  },
  serverExternalPackages: ["pg"],
};

export default nextConfig;
