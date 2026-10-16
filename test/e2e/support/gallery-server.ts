import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { build } from 'esbuild'

/** Real UI, test-only media. Cloud QA separately exercises admission and private delivery. */
export async function startGalleryFixture() {
  const bundle = await build({
    entryPoints: ['test/e2e/support/gallery-fixture.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_GALLERY_RETENTION_HOURS': '"24"',
    },
  })
  const script = bundle.outputFiles[0]
  if (!script) throw new Error('Gallery fixture did not build')
  const css = await readFile('example/app/globals.css')
  const photo = await readFile('test/e2e/fixtures/wedding-photo-01.png')
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/gallery.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end(script.contents)
    } else if (path === '/gallery.css') {
      response.writeHead(200, { 'content-type': 'text/css' })
      response.end(css)
    } else if (path === '/api/transloadit/media') {
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
      response.end(photo)
    } else if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gallery test</title><link rel="stylesheet" href="/gallery.css"></head><body><div id="root"></div><script src="/gallery.js"></script></body></html>',
      )
    } else if (path === '/favicon.ico') {
      response.writeHead(204)
      response.end()
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing gallery fixture address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}
