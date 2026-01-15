# Contributing

Thanks for helping improve the Convex Transloadit component. This guide covers local setup, testing, and the release flow.

## Requirements

- Node.js 24+
- Yarn 4 (Corepack)

## Install

```bash
corepack enable
yarn install --immutable
```

## Tests and QA

Fast checks:

```bash
yarn lint
yarn typecheck
yarn test
```

End-to-end flow (uses Transloadit credentials and a Cloudflare tunnel):

```bash
cp .env.example .env
# Set TRANSLOADIT_KEY and TRANSLOADIT_SECRET
yarn qa:full

# Or with verbose logging
yarn qa:full:verbose
```

Template management (idempotent):

```bash
yarn template:ensure
```

## Release process

Releases are automated via GitHub Actions and published to npm using OIDC (Trusted Publisher).

1. Ensure CI is green on `main`.
2. Run the local check suite:

```bash
yarn check
```

3. Update `package.json` version and commit it:

```bash
git checkout main
git pull
# edit package.json version, then:
git add package.json
git commit -m "Release v0.0.2"
git push
```

4. Tag and push the release:

```bash
git tag v0.0.2
git push origin v0.0.2
```

5. The `Publish to npm` workflow will:
   - build and pack a `.tgz` artifact,
   - create a **draft** GitHub release,
   - publish the tarball to npm with provenance.

Notes:
- npm publishing requires the npm package to be configured as a Trusted Publisher for this repo.
- Draft releases can be finalized in GitHub after verifying the published package.
