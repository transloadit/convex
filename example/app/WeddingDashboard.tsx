'use client'

import Dashboard from '@uppy/react/dashboard'
import { useLocale, useTranslations } from 'next-intl'
import { uppyLocales } from '../i18n/uppy'
import type { WeddingUppy } from './useWeddingUppy'

export default function WeddingDashboard({
  uppy,
  disabled,
}: {
  uppy: WeddingUppy
  disabled: boolean
}) {
  const t = useTranslations('upload')
  const locale = useLocale()
  return (
    <Dashboard
      uppy={uppy}
      disabled={disabled}
      locale={uppyLocales[locale]}
      height={280}
      width="100%"
      proudlyDisplayPoweredByUppy={false}
      hideUploadButton
      // Retry through the validated submit path, including completion/reveal feedback.
      hideRetryButton
      note={t('limit')}
    />
  )
}
