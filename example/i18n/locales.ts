export const locales = ['en', 'nl', 'uk', 'de'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'
export const localeLabels: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
  uk: 'Українська',
  de: 'Deutsch',
}
export const localeCookie = { name: 'NEXT_LOCALE', maxAge: 365 * 24 * 60 * 60 }
export const isLocale = (value: unknown): value is Locale =>
  locales.some((locale) => locale === value)
