export type TransloaditErrorContext =
  | 'createAssembly'
  | 'upload'
  | 'polling'
  | 'status'
  | 'webhook'
  | 'payload'
  | 'config'

export class TransloaditError extends Error {
  readonly context: TransloaditErrorContext

  constructor(context: TransloaditErrorContext, message: string) {
    super(`Transloadit ${context}: ${message}`)
    this.name = 'TransloaditError'
    this.context = context
  }
}

export const transloaditError = (
  context: TransloaditErrorContext,
  message: string,
): TransloaditError => new TransloaditError(context, message)
