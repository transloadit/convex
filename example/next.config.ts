import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, noimageindex' }],
      },
    ]
  },
  experimental: {
    externalDir: true,
  },
}

export default createNextIntlPlugin()(nextConfig)
