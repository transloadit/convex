import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'
import './globals.css'
import { wedding } from '../lib/wedding'

export const metadata = {
  title: `${wedding.names} · Our wedding album`,
  description: 'One day. All our favourite people. Share and relive every little moment.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" as="image" href={wedding.cover} fetchPriority="high" />
      </head>
      <body>{children}</body>
    </html>
  )
}
