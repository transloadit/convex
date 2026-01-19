export const weddingSteps = {
  // These steps use Transloadit's hosted storage (temporary). Add a storage
  // robot (e.g. /s3/store) to persist uploads beyond ~24 hours.
  ":original": {
    robot: "/upload/handle",
  },
  images_filtered: {
    use: ":original",
    robot: "/file/filter",
    accepts: [["$" + "{file.mime}", "regex", "^image"]],
    error_on_decline: false,
  },
  videos_filtered: {
    use: ":original",
    robot: "/file/filter",
    accepts: [["$" + "{file.mime}", "regex", "^video"]],
    error_on_decline: false,
  },
  images_resized: {
    use: "images_filtered",
    robot: "/image/resize",
    width: 1600,
    height: 1600,
    resize_strategy: "fit",
    result: true,
  },
  videos_encoded: {
    use: "videos_filtered",
    robot: "/video/encode",
    preset: "ipad-high",
    result: true,
  },
};

export const weddingStepNames = {
  image: "images_resized",
  video: "videos_encoded",
};
