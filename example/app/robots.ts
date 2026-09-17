import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  // Crawlers can read the public entry page's noindex directive; album data requires a session.
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/transloadit/'] } }
}
