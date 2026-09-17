import { ConvexError } from 'convex/values'
import { expect, test } from 'vitest'
import { getUploadErrorCode } from './upload-errors'

test('recovers a translated invite-code error through Uppy’s error wrapper', () => {
  expect(
    getUploadErrorCode(
      Object.assign(new Error('Could not create Assembly'), {
        cause: new ConvexError('INVITE_REQUIRED'),
      }),
    ),
  ).toBe('INVITE_REQUIRED')
})

test('does not expose unknown server errors or loop on circular causes', () => {
  const error = new Error('internal server detail')
  Object.assign(error, { cause: error })
  expect(getUploadErrorCode(error)).toBe('UPLOAD_FAILED')
})
