'use client'

import dynamic from 'next/dynamic'

const WeddingUploadsClient = dynamic(() => import('./WeddingUploadsClient'), {
  ssr: false,
})

export default function WeddingUploadsApp({ convexUrl }: { convexUrl: string }) {
  return <WeddingUploadsClient convexUrl={convexUrl} />
}
