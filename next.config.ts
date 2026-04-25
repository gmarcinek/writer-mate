import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  experimental: {
    // serverComponentsExternalPackages przeniesione do serverExternalPackages w Next 15
  },
  serverExternalPackages: ["pg"],
};

export default withNextIntl(nextConfig);
