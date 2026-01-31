export const weddingStepNames = {
  image: 'images_resized',
  video: 'videos_encoded',
  videoThumbs: 'videos_thumbs',
};

export type {
  AssemblyOptions,
  AssemblyResponse,
  AssemblyResultResponse,
  AssemblyStatus,
} from '@transloadit/convex';

export {
  ASSEMBLY_STATUS_COMPLETED,
  ASSEMBLY_STATUS_UPLOADING,
  getAssemblyStage,
  getResultOriginalKey,
  getResultUrl,
  isAssemblyBusyStatus,
  isAssemblyCompletedStatus,
  isAssemblyTerminal,
  isAssemblyTerminalError,
  isAssemblyTerminalOk,
  isAssemblyTerminalOkStatus,
  isAssemblyUploadingStatus,
  parseAssemblyStatus,
  pollAssembly,
} from '@transloadit/convex';
