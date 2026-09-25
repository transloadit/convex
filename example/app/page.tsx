import { getTranslations } from 'next-intl/server'
import { getConvexUrl } from '../lib/convex-url'
import WeddingUploadsApp from './WeddingUploadsApp'

export const dynamic = 'force-dynamic'

export default async function WeddingUploadsPage() {
  // A shared URL must never redirect guest names and invitation codes to another backend.
  const convexUrl = getConvexUrl()

  // Convex assigns preview hosts independently of Git branch names. A missing deployment URL
  // must not start guest authentication against a guessed host or fall back to local upload mode.
  const hosted = process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'production'
  if (hosted && !convexUrl) {
    const t = await getTranslations('album')
    return (
      <main className="page unavailable-message">
        <section role="alert">
          <h1>{t('unavailable')}</h1>
          <p>{t('unavailableHint')}</p>
        </section>
      </main>
    )
  }
  return <WeddingUploadsApp convexUrl={convexUrl} />
}
