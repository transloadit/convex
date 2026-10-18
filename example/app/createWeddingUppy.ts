import Uppy from '@uppy/core'
import Transloadit from '@uppy/transloadit'
import { uppyLocales } from '../i18n/uppy'
import type { AssemblyOptions } from '../lib/transloadit'

/** Browser-only upload dependencies, loaded on the first request to open the uploader. */
export function createWeddingUppy(getAssemblyOptions: () => Promise<AssemblyOptions>) {
  const uppy = new Uppy<Record<string, unknown>, Record<string, unknown>>({
    autoProceed: false,
    restrictions: {
      allowedFileTypes: ['image/*', 'video/*'],
      maxNumberOfFiles: 12,
      minFileSize: 1,
    },
  }).use(Transloadit, { waitForEncoding: true, assemblyOptions: getAssemblyOptions })
  return { uppy, locales: uppyLocales }
}
