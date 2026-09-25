import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'
import './globals.css'
import { ConvexAuthNextjsServerProvider } from '@convex-dev/auth/nextjs/server'
import { getLocale, getTranslations } from 'next-intl/server'
import { AlbumIntlProvider } from '../i18n/AlbumIntlProvider'
import { getConvexUrl } from '../lib/convex-url'
import { wedding } from '../lib/wedding'

export async function generateMetadata() {
  const t = await getTranslations('album')
  return {
    title: t('title', { names: wedding.names }),
    description: t('description'),
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false, noimageindex: true },
    },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const convexUrl = getConvexUrl()
  const document = (
    <html lang={locale}>
      <body>
        <AlbumIntlProvider initialLocale={locale}>{children}</AlbumIntlProvider>
      </body>
    </html>
  )
  // The server provider hands the cookie session to the browser client without exposing a
  // refresh token to scripts. The URL is a runtime value, so it doubles as the storage namespace.
  // Sessions from the earlier browser-only provider are not migrated: those guests enter again.
  return convexUrl ? (
    <ConvexAuthNextjsServerProvider storageNamespace={convexUrl}>
      {document}
    </ConvexAuthNextjsServerProvider>
  ) : (
    document
  )
}
