export const weddingSteps = {
  ":original": {
    robot: "/upload/handle",
  },
  images_filtered: {
    use: ":original",
    robot: "/file/filter",
    accepts: [[String.raw`\${file.mime}`, "regex", "^image"]],
    error_on_decline: false,
  },
  videos_filtered: {
    use: ":original",
    robot: "/file/filter",
    accepts: [[String.raw`\${file.mime}`, "regex", "^video"]],
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
    preset: "mp4",
    result: true,
  },
};

export const weddingStepNames = {
  image: "images_resized",
  video: "videos_encoded",
};
