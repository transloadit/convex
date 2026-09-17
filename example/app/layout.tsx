import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'
import './globals.css'
import { getLocale, getTranslations } from 'next-intl/server'
import { AlbumIntlProvider } from '../i18n/AlbumIntlProvider'
import { wedding } from '../lib/wedding'

export async function generateMetadata() {
  const t = await getTranslations('album')
  return { title: t('title', { names: wedding.names }), description: t('description') }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale}>
      <head>
        <link rel="preload" as="image" href={wedding.cover} fetchPriority="high" />
      </head>
      <body>
        <AlbumIntlProvider initialLocale={locale}>{children}</AlbumIntlProvider>
      </body>
    </html>
  )
}
