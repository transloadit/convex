'use client'

import { useTranslations } from 'next-intl'
import { useAlbumLocale } from '../i18n/AlbumIntlProvider'
import { isLocale, localeLabels, locales } from '../i18n/locales'

export const LanguageSwitcher = () => {
  const t = useTranslations('language')
  const { locale, changeLocale } = useAlbumLocale()
  return (
    <label className="language-picker">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </svg>
      <span aria-hidden="true">
        {locale.toUpperCase()} <span className="language-chevron">⌄</span>
      </span>
      <select
        aria-label={t('label', { language: localeLabels[locale] })}
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) changeLocale(event.target.value)
        }}
      >
        {locales.map((code) => (
          <option key={code} value={code} lang={code}>
            {localeLabels[code]}
          </option>
        ))}
      </select>
    </label>
  )
}
