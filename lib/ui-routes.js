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
 * Host-side capability marker. The client compares this against its own
 * expected version: a mismatch means the running host module is older than the
 * loaded browser bundle (the classic "reinstalled but did not restart" state).
 */
export const API_VERSION = 2

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
        if (route === '/health') {
          return json(200, { ok: true, service: 'file-recall', apiVersion: API_VERSION })
        }
        if (route === '/status') {
          const base = indexer.status()
          let ocr = null
          try {
            ocr = ocrStatus ? await ocrStatus() : null
          } catch (error) {
            ocr = { error: String(error?.message ?? error) }
          }
          return json(200, { ...base, ocr, apiVersion: API_VERSION })
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
