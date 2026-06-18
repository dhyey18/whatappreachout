import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@whiskeysockets/baileys',
    '@hapi/boom',
    'pino',
    'pino-pretty',
  ],
};

export default nextConfig;
