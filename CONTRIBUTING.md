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

Smoke test (creates a minimal assembly and prints the response JSON):

```bash
cp .env.example .env
# Set TRANSLOADIT_KEY and TRANSLOADIT_SECRET
yarn smoke
```

Local webhook testing with cloudflared:

```bash
yarn tunnel
```

Use the generated public URL as `notifyUrl` when creating Assemblies or set
`VITE_TRANSLOADIT_NOTIFY_URL` for the example app.

You can also run `yarn tunnel --once` to print the URL and exit.

Full QA flow (template + tunnel + webhook):

This runs an end-to-end webhook QA flow against Transloadit using a local webhook
server and cloudflared (auto-downloaded if missing):

```bash
cp .env.example .env
# Set TRANSLOADIT_KEY and TRANSLOADIT_SECRET
yarn qa:full

# Or with verbose logging
yarn qa:full:verbose
```

It prints a JSON summary including the assembly id, webhook status, and number of stored results.

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
