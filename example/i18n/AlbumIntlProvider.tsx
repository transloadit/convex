'use client'

import { NextIntlClientProvider, useTranslations } from 'next-intl'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { wedding } from '../lib/wedding'
import { defaultLocale, type Locale, localeCookie } from './locales'
import { messages } from './messages'

const LocaleContext = createContext({
  locale: defaultLocale,
  changeLocale: (_locale: Locale) => {},
})
export const useAlbumLocale = () => useContext(LocaleContext)

const DocumentLanguage = ({ locale }: { locale: Locale }) => {
  const t = useTranslations('album')
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = t('title', { names: wedding.names })
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (description) description.content = t('description')
  }, [locale, t])
  return null
}

export const AlbumIntlProvider = ({
  initialLocale,
  children,
}: {
  initialLocale: Locale
  children: ReactNode
}) => {
  const [locale, setLocale] = useState(initialLocale)
  const changeLocale = (nextLocale: Locale) => {
    // Cookie Store requires newer browsers; this preference also needs to work on older phones.
    // biome-ignore lint/suspicious/noDocumentCookie: Keep the server-readable locale compatible with older browsers.
    document.cookie = `${localeCookie.name}=${nextLocale}; Path=/; Max-Age=${localeCookie.maxAge}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
    setLocale(nextLocale)
  }
  // Update the provider in place: navigating or keying the uploader by locale would discard files.
  return (
    <LocaleContext value={{ locale, changeLocale }}>
      <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
        <DocumentLanguage locale={locale} />
        {children}
      </NextIntlClientProvider>
    </LocaleContext>
  )
}
