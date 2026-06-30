import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is the default in Next.js 16, but we need to use webpack
  // because pdfjs-dist tries to pull in the Node.js canvas module.
  // The --webpack flag enables this config.
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
