'use client'

import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { useConvexAuth, useQuery } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useState } from 'react'
import { maxGuestNameLength } from '../lib/guest-name'
import { getUploadErrorCode, type UploadErrorCode } from '../lib/upload-errors'
import { wedding } from '../lib/wedding'
import { LanguageSwitcher } from './LanguageSwitcher'

export type Guest = { userId: string; name: string }
type GateProps = { children: (guest: Guest, onLeave: () => void) => ReactNode }
type Settings = { requiresInviteCode: boolean }
const settingsRef = makeFunctionReference<'query', Record<string, never>, Settings>(
  'guests:settings',
)
const viewerRef = makeFunctionReference<'query', Record<string, never>, Guest | null>(
  'guests:viewer',
)

const EntryForm = ({
  requiresInviteCode,
  busy,
  error,
  onEnter,
}: {
  requiresInviteCode: boolean
  busy: boolean
  error: UploadErrorCode | null
  onEnter: (name: string, code: string) => Promise<void>
}) => {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  return (
    <main className="album-entry" data-testid="album-entry">
      <div className="entry-language">
        <LanguageSwitcher />
      </div>
      <section className="entry-card" aria-labelledby="entry-title">
        <span className="entry-monogram" aria-hidden="true">
          {wedding.initials}
        </span>
        <p className="eyebrow">{t('access.eyebrow')}</p>
        <h1 id="entry-title">{wedding.names}</h1>
        <p className="entry-intro">{t('access.intro')}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void onEnter(name.trim(), code)
          }}
        >
          <label className="input">
            <span>{t('upload.name')}</span>
            <input
              name="guestName"
              value={name}
              onChange={(event) => {
                event.target.setCustomValidity('')
                setName(event.target.value)
              }}
              onInvalid={(event) =>
                event.currentTarget.setCustomValidity(t('errors.NAME_REQUIRED'))
              }
              required
              pattern=".*\S.*"
              maxLength={maxGuestNameLength}
              autoComplete="name"
              placeholder={t('upload.guestPlaceholder')}
              disabled={busy}
            />
          </label>
          {requiresInviteCode && (
            <label className="input">
              <span>{t('upload.inviteCode')}</span>
              <input
                name="uploadCode"
                type="password"
                autoComplete="current-password"
                required
                value={code}
                onChange={(event) => {
                  event.target.setCustomValidity('')
                  setCode(event.target.value)
                }}
                onInvalid={(event) =>
                  event.currentTarget.setCustomValidity(t('errors.INVITE_REQUIRED'))
                }
                disabled={busy}
              />
            </label>
          )}
          {error && (
            <p className="entry-error" role="alert">
              {t(`errors.${error}`)}
            </p>
          )}
          <button
            className="button entry-submit"
            type="submit"
            disabled={busy}
            data-testid="enter-album"
          >
            {busy ? t('access.entering') : t('access.enter')} <span aria-hidden="true">→</span>
          </button>
        </form>
        <p className="entry-footnote">{t('access.footnote')}</p>
      </section>
    </main>
  )
}

export const CloudAlbumGate = ({ children }: GateProps) => {
  const { signIn, signOut } = useAuthActions()
  const token = useAuthToken()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const settings = useQuery(settingsRef, {})
  const guest = useQuery(viewerRef, isAuthenticated ? {} : 'skip')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UploadErrorCode | null>(null)
  if (isAuthenticated && guest && !busy && !error)
    return children(guest, () => {
      // Unmount album subscriptions before the server revokes their session.
      setBusy(true)
      void signOut()
        .catch(() => setError('LOGIN_FAILED'))
        .finally(() => setBusy(false))
    })
  return (
    <EntryForm
      requiresInviteCode={settings?.requiresInviteCode ?? false}
      busy={busy || isLoading || !settings || (isAuthenticated && guest === undefined)}
      error={error}
      onEnter={async (name, code) => {
        setBusy(true)
        setError(null)
        try {
          // Replacing one token with another while already authenticated can leave the
          // Convex connection using the old session. Clear it before re-entering the album.
          if (token !== null) await signOut()
          const result = await signIn('guest', { guestName: name, uploadCode: code })
          if (!result.signingIn) setError('LOGIN_FAILED')
        } catch (error) {
          const reason = getUploadErrorCode(error)
          setError(reason === 'UPLOAD_FAILED' ? 'LOGIN_FAILED' : reason)
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}

export const LocalAlbumGate = ({ children }: GateProps) => {
  const [guest, setGuest] = useState<Guest | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<UploadErrorCode | null>(null)
  useEffect(() => {
    const request = new AbortController()
    void fetch('/api/session', { signal: request.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('LOGIN_FAILED')
        const result = await response.json()
        if (!request.signal.aborted) {
          setGuest(result.guest)
          setSettings(result)
        }
      })
      .catch(() => {
        if (!request.signal.aborted) setError('LOGIN_FAILED')
      })
      .finally(() => {
        if (!request.signal.aborted) setBusy(false)
      })
    return () => request.abort()
  }, [])
  if (guest && !busy && !error)
    return children(guest, () => {
      setBusy(true)
      void fetch('/api/session', { method: 'DELETE' })
        .then((response) => {
          if (!response.ok) throw new Error('LOGIN_FAILED')
          setGuest(null)
        })
        .catch(() => setError('LOGIN_FAILED'))
        .finally(() => setBusy(false))
    })
  return (
    <EntryForm
      requiresInviteCode={settings?.requiresInviteCode ?? false}
      busy={busy}
      error={error}
      onEnter={async (name, code) => {
        setBusy(true)
        setError(null)
        try {
          const response = await fetch('/api/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ guestName: name, uploadCode: code }),
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error ?? 'LOGIN_FAILED')
          setGuest(result.guest)
        } catch (error) {
          setError(getUploadErrorCode(error))
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}
