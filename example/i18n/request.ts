import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { defaultLocale, isLocale, localeCookie } from './locales'
import { messages } from './messages'

export default getRequestConfig(async () => {
  const preference = (await cookies()).get(localeCookie.name)?.value
  const locale = isLocale(preference) ? preference : defaultLocale
  return { locale, messages: messages[locale], timeZone: 'UTC' }
})
