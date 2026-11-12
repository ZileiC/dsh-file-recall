/**
 * Same-origin JSON routes for the client panel.
 *
 * Read-only by design: the panel displays index state and recent feedback but
 * never mutates the index. Mutations stay on the model's tools, where the
 * agent's approval and the skill's guidance apply.
 *
 * Registered as a `WebResourceRoute` (`resource: (request) => Promise<Response>`).
 * The sibling `WebRoute.handler` form is Node-style `(req, res)`; we return a
 * Response instead, so it must be a resource route.
 */

const PREFIX = '/api/file-recall'

function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
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
    async resource(request) {
      const method = String(request.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') {
        return json(405, { error: 'method not allowed' })
      }

      const url = new URL(request.url)
      const route = url.pathname.slice(PREFIX.length) || '/'

      try {
        if (route === '/status') {
          const base = indexer.status()
          let ocr = null
          try {
            ocr = ocrStatus ? await ocrStatus() : null
          } catch (error) {
            ocr = { error: String(error?.message ?? error) }
          }
          return json(200, { ...base, ocr })
        }
        if (route === '/recent') {
          return json(200, { feedback: store.listFeedback(8) })
        }
        return json(404, { error: 'not found' })
      } catch (error) {
        return json(500, { error: String(error?.message ?? error) })
      }
    },
  })
}
