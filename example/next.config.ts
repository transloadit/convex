import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
  },
}

export default createNextIntlPlugin()(nextConfig)
