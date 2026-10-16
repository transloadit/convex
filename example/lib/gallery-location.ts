'use client'

import { useSyncExternalStore } from 'react'

const changed = 'wedding-media-location'
const marker = 'weddingMediaEntry'
const read = () => new URLSearchParams(window.location.search).get('media')
const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify)
  window.addEventListener(changed, notify)
  return () => {
    window.removeEventListener('popstate', notify)
    window.removeEventListener(changed, notify)
  }
}

/** Asset/version identity only; the URL grants no access to the album or media. */
export function useGalleryLocation() {
  return useSyncExternalStore(subscribe, read, () => null)
}

/** Opening adds one entry, navigating replaces it, Back closes instead of visiting every slide. */
export function selectGalleryMedia(id: string | null) {
  const url = new URL(window.location.href)
  const wasOpen = url.searchParams.has('media')
  if (id === null && window.history.state?.[marker] === true) {
    window.history.back()
    return
  }
  if (id === null) url.searchParams.delete('media')
  else url.searchParams.set('media', id)
  const state = {
    ...window.history.state,
    [marker]: id !== null && (!wasOpen || window.history.state?.[marker] === true),
  }
  if (id !== null && !wasOpen) window.history.pushState(state, '', url)
  else window.history.replaceState(state, '', url)
  window.dispatchEvent(new Event(changed))
}

/** Refuse malformed links without querying or exposing which assets exist. */
export function parseGalleryMedia(id: string | null) {
  if (!id || !/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/.test(id)) return null
  const [assetId, versionId] = id.split('.')
  return assetId && versionId ? { assetId, versionId } : null
}
