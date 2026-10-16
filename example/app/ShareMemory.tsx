'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

interface ShareState {
  id: string
  status: 'idle' | 'sharing' | 'copied'
  manualLink: string | null
}

/** Shares an album identity, never a short-lived delivery grant or an access token. */
export function ShareMemory({ id, name }: { id: string; name: string }) {
  const t = useTranslations('viewer')
  const [state, setState] = useState<ShareState>({ id, status: 'idle', manualLink: null })
  // Reset feedback per visit without remounting the focused Share button.
  if (state.id !== id) setState({ id, status: 'idle', manualLink: null })

  async function share() {
    const url = new URL(window.location.pathname, window.location.origin)
    url.searchParams.set('media', id)
    const request: ShareState = { id, status: 'sharing', manualLink: null }
    setState(request)
    const result: ShareState = { id, status: 'idle', manualLink: null }
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url: url.href })
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url.href)
        result.status = 'copied'
      } else {
        result.manualLink = url.href
      }
    } catch (error) {
      // Dismissing the native sheet is not a failed share or permission to copy silently.
      if (!(error instanceof Error && error.name === 'AbortError')) result.manualLink = url.href
    }
    // A share sheet can outlive navigation, including a return to the same photo.
    setState((current) => (current === request ? result : current))
  }

  return (
    <div className="viewer-share">
      <button type="button" onClick={() => void share()} disabled={state.status === 'sharing'}>
        {t('share')}
      </button>
      {state.status === 'copied' ? (
        <span role="status" className="viewer-share-feedback">
          {t('copied')}
        </span>
      ) : null}
      {state.manualLink ? (
        <div className="viewer-share-feedback">
          <p role="status">{t('shareManually')}</p>
          <input
            aria-label={t('shareLink')}
            readOnly
            value={state.manualLink}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}
    </div>
  )
}
