# Contributing

Thanks for improving `@transloadit/convex`! Please keep changes focused and run checks before sending
them out.

## Development

```bash
yarn check
```

This runs format, lint, typecheck, and unit tests. For the full verification suite:

```bash
yarn verify
```

## Releases (Changesets)

Releases are managed via Changesets and GitHub Actions. The package stays on 0.x while we iterate,
so breaking changes are allowed but must be described in the changeset.

1. Create a changeset:

```bash
yarn changeset
```

2. Commit and push it to `main`.
3. The Changesets workflow will open a “Version Packages” PR.
4. Merge that PR to publish to npm and tag the release.

## Stable demo URLs

The example app expects a stable Convex deployment for cloud verification.

1. Create or use a production Convex deployment (deploy key must be a production key):

```bash
CONVEX_DEPLOY_KEY=... yarn deploy:cloud
```

2. Use the printed deployment URL (e.g. `https://<deployment>.convex.cloud`) as the stable Convex
   URL:
   - GitHub Actions secret: `E2E_REMOTE_CONVEX_URL`
   - Vercel env var: `NEXT_PUBLIC_CONVEX_URL`

3. The stable demo URL is the Vercel production URL (e.g. `https://convex-demo.transload.it`) and
   should be stored in the GitHub Actions secret `E2E_REMOTE_APP_URL`.
