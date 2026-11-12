/**
 * Same-origin JSON routes for the client panel.
 *
 * Read-only by design: the panel displays index state and recent feedback but
 * never mutates the index. Mutations stay on the model's tools, where the
 * agent's approval and the skill's guidance apply.
 *
 * `ctx.webServer.register` takes Node HTTP handlers (IncomingMessage ->
 * ServerResponse), not Fetch handlers.
 */

const PREFIX = '/api/file-recall'

function send(res, statusCode, body) {
  const payload = JSON.stringify(body)
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(payload))
  res.end(payload)
}

/**
 * @param {{
 *   webServer: { register(route: object): () => void },
 *   indexer: object,
 *   store: object,
 *   ocrStatus: () => Promise<object>,
 * }} deps
 */
export function registerUiRoutes({ webServer, indexer, store, ocrStatus }) {
  return webServer.register({
    kind: 'prefix',
    path: PREFIX,
    async handler(req, res) {
      const method = String(req.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') {
        send(res, 405, { error: 'method not allowed' })
        return
      }

      const pathname = String(req.url ?? PREFIX).split('?')[0]
      const route = pathname.slice(PREFIX.length) || '/'

      try {
        if (route === '/status') {
          const base = indexer.status()
          let ocr = null
          try {
            ocr = ocrStatus ? await ocrStatus() : null
          } catch (error) {
            ocr = { error: String(error?.message ?? error) }
          }
          send(res, 200, { ...base, ocr })
          return
        }
        if (route === '/recent') {
          send(res, 200, { feedback: store.listFeedback(8) })
          return
        }
        send(res, 404, { error: 'not found' })
      } catch (error) {
        send(res, 500, { error: String(error?.message ?? error) })
      }
    },
  })
}
