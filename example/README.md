# Example App

This is a minimal Vite + React app wired to the Transloadit Convex component.

## Setup

1. Install deps:

```bash
cd example
yarn install
```

2. Configure Convex:

```bash
npx convex dev
```

3. In another terminal, run the app:

```bash
yarn dev
```

4. Set environment variables in Convex:

```bash
npx convex env set TRANSLOADIT_AUTH_KEY <your_auth_key>
npx convex env set TRANSLOADIT_AUTH_SECRET <your_auth_secret>
```

Aliases also supported:

```bash
npx convex env set TRANSLOADIT_KEY <your_auth_key>
npx convex env set TRANSLOADIT_SECRET <your_auth_secret>
```

5. Add `example/.env` based on `example/.env.example`, and set
   `VITE_TRANSLOADIT_TEMPLATE_ID`.

## Webhook

Configure Transloadit to call:

```
https://<your-convex-deployment>.convex.site/transloadit/webhook
```

The route is registered in `example/convex/http.ts`.

## Local webhook testing with cloudflared

Run Convex dev, then open a tunnel to the local HTTP endpoint:

```bash
yarn tunnel
```

Copy the public URL and set it in `example/.env` as `VITE_TRANSLOADIT_NOTIFY_URL`.
You can also run `yarn tunnel --once` to print the URL and exit.
