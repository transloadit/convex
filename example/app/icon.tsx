import { ImageResponse } from 'next/og'
import { wedding } from '../lib/wedding'

export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: '#f7f6f2',
        color: '#2e3329',
        fontSize: 24,
      }}
    >
      {wedding.initials}
    </div>,
    size,
  )
}
