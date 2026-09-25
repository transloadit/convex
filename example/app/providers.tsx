'use client'

import { ConvexAuthNextjsProvider } from '@convex-dev/auth/nextjs'
import { ConvexReactClient } from 'convex/react'
import { useMemo } from 'react'

export const Providers = ({
  convexUrl,
  children,
}: {
  convexUrl: string
  children: React.ReactNode
}) => {
  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl])
  return <ConvexAuthNextjsProvider client={client}>{children}</ConvexAuthNextjsProvider>
}
