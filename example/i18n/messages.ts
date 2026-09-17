import de from '../messages/de.json'
import en from '../messages/en.json'
import nl from '../messages/nl.json'
import uk from '../messages/uk.json'
import type { Locale } from './locales'

export const messages = { en, nl, uk, de } satisfies Record<Locale, typeof en>

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale
    Messages: typeof en
  }
}
