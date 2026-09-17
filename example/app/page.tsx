import WeddingUploadsApp from './WeddingUploadsApp'

export const dynamic = 'force-dynamic'

export default async function WeddingUploadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ convexUrl?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const convexUrl =
    resolvedSearchParams?.convexUrl ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL

  // Convex assigns preview hosts independently of Git branch names. A missing deployment URL
  // must not start guest authentication against a guessed host or fall back to local upload mode.
  const hosted = process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'production'
  if (hosted && !convexUrl) {
    return (
      <main className="page">
        <section className="panel" role="alert">
          <h1 className="headline">Gallery temporarily unavailable</h1>
          <p className="subhead">Uploads are unavailable right now. Please try again later.</p>
        </section>
      </main>
    )
  }
  return <WeddingUploadsApp convexUrl={convexUrl} />
}
