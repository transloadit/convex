// Assembly Steps whose R2 results the gallery renders. Storage receipts never travel this path.
export const galleryResultSteps = {
  images_resized: { kind: 'image', stored: false },
  images_output: { kind: 'image', stored: true },
  videos_encoded: { kind: 'video', stored: false },
  videos_output: { kind: 'video', stored: true },
  videos_thumbs: { kind: 'poster', stored: false },
  videos_thumbs_output: { kind: 'poster', stored: true },
} as const

const galleryStepNames: ReadonlySet<string> = new Set(Object.keys(galleryResultSteps))

export const isGalleryResultStep = (
  stepName: string,
): stepName is keyof typeof galleryResultSteps => galleryStepNames.has(stepName)
