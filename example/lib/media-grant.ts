// Network failures are the only ones an expired grant causes (MediaError.MEDIA_ERR_NETWORK).
const networkError = 2

/**
 * Renews a video's expired CDN grant through its stable, authorized route URL.
 *
 * Browsers request later byte ranges from a media source's redirect target, so a seek or resume
 * after the route's short-lived grant expires fails with a network error. Reloading the same route
 * URL reauthorizes the guest and redirects to a fresh grant; position and playing state are then
 * restored. Only a grant that has delivered media can be renewed, once per failure: a refused
 * reauthorization fails before metadata loads and stays refused, never falling back elsewhere.
 * Pass as a stable `ref`; the returned cleanup detaches it.
 */
export const renewExpiredGrants = (video: HTMLVideoElement | null) => {
  if (!video) return
  let renewable = false
  // Chromium pauses only after reporting the error, so track the intent beforehand.
  let playing = !video.paused
  const controller = new AbortController()
  const { signal } = controller
  const on = (type: string, listener: () => void, once = false) =>
    video.addEventListener(type, listener, { signal, once })

  on(
    'loadedmetadata',
    () => {
      renewable = true
    },
    true,
  )
  on('play', () => {
    playing = true
  })
  on('pause', () => {
    playing = false
  })
  // A pending restore belongs to one renewal; a refused renewal must not move a later source.
  let restore: AbortController | undefined
  on('error', () => {
    restore?.abort()
    if (!renewable || video.error?.code !== networkError) return
    renewable = false
    const position = video.currentTime
    const resume = playing
    restore = new AbortController()
    const options = { signal: restore.signal, once: true }
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = position
        video.addEventListener(
          'seeked',
          () => {
            // Re-arm only after the new grant delivered media at the restored position, so each
            // renewal follows real progress. Production grants also leave minutes between them.
            renewable = true
            // Autoplay policies can refuse this; the guest then still has the native controls.
            if (resume) video.play().catch(() => {})
          },
          options,
        )
      },
      options,
    )
    video.load()
  })
  return () => {
    controller.abort()
    restore?.abort()
  }
}
