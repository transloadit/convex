export const weddingStepNames = {
  image: "images_output",
  video: "videos_output",
};

export const parseAssemblyUrls = (data: Record<string, unknown>) => {
  const tusUrl = typeof data.tus_url === "string" ? data.tus_url : "";
  const assemblyUrl =
    (typeof data.assembly_ssl_url === "string" && data.assembly_ssl_url) ||
    (typeof data.assembly_url === "string" && data.assembly_url) ||
    "";
  return { tusUrl, assemblyUrl };
};
