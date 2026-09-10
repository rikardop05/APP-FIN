import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Erro de tipo ou de lint nao passa no build (CONVENTIONS §6).
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
