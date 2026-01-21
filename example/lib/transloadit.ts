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
  buildTusUploadConfig,
  isAssemblyBusyStatus,
  isAssemblyTerminal,
  isAssemblyTerminalError,
  isAssemblyTerminalOk,
  isAssemblyTerminalOkStatus,
  parseAssemblyStatus,
} from "../../src/client/index.ts";
