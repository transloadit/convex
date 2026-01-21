export const weddingStepNames = {
  image: "images_resized",
  video: "videos_encoded",
  videoThumbs: "videos_thumbs",
};

export type {
  AssemblyResponse,
  AssemblyResultResponse,
  AssemblyStatus,
} from "../../src/client/index.ts";

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
} from "../../src/client/index.ts";

export type { UppyUploadResult } from "../../src/react/index.tsx";
export {
  uploadWithAssembly,
  useAssemblyPoller,
} from "../../src/react/index.tsx";
