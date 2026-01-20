const siteUrl =
  process.env.CONVEX_SITE_URL ??
  (process.env.CONVEX_URL?.includes(".convex.cloud")
    ? process.env.CONVEX_URL.replace(".convex.cloud", ".convex.site")
    : process.env.CONVEX_URL);

if (!siteUrl) {
  throw new Error("Missing CONVEX_SITE_URL or CONVEX_URL for auth.config.ts");
}

export default {
  providers: [
    {
      type: "customJwt",
      issuer: siteUrl,
      jwks: `${siteUrl}/transloadit/jwks`,
      algorithm: "RS256",
      applicationID: "convex",
    },
  ],
};
