export const weddingStepNames = {
  image: "images_resized",
  video: "videos_encoded",
  videoThumbs: "videos_thumbs",
};

export type {
  AssemblyResponse,
  AssemblyResultResponse,
  AssemblyStatus,
} from "@transloadit/convex";

export {
  ASSEMBLY_STATUS_COMPLETED,
  ASSEMBLY_STATUS_UPLOADING,
  buildTusUploadConfig,
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
} from "@transloadit/convex";

export type { UppyUploadResult } from "@transloadit/convex/react";
export {
  uploadWithAssembly,
  useAssemblyPoller,
  useTransloaditUppy,
} from "@transloadit/convex/react";
