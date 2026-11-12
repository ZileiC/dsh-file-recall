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

/** Mount path, exported so the host can report it from a tool. */
export const ROUTE_PATH = PREFIX

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
 *
 * 3 — added `/activity` (live recall events for the panel animation).
 */
export const API_VERSION = 3

/**
 * @param {{
 *   webServer: { register(route: object): () => void },
 *   indexer: object,
 *   store: object,
 *   ocrStatus: () => Promise<object>,
 *   activity?: { since(id: number): object[], latestId(): number },
 * }} deps
 */
export function registerUiRoutes({ webServer, indexer, store, ocrStatus, activity = null }) {
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
          return json(200, {
            ok: true,
            service: 'file-recall',
            apiVersion: API_VERSION,
            features: { activity: activity !== null },
          })
        }
        if (route === '/status') {
          const base = indexer.status()
          let ocr = null
          try {
            ocr = ocrStatus ? await ocrStatus() : null
          } catch (error) {
            ocr = { error: String(error?.message ?? error) }
          }
          return json(200, {
            ...base,
            ocr,
            activity: activity ? { latest: activity.latestId() } : null,
            apiVersion: API_VERSION,
          })
        }
        if (route === '/recent') {
          return json(200, { feedback: store.listFeedback(8) })
        }
        if (route === '/activity') {
          const since = Number(url.searchParams.get('since') ?? 0) || 0
          const events = activity ? activity.since(since) : []
          return json(200, {
            events,
            latest: activity ? activity.latestId() : 0,
            apiVersion: API_VERSION,
          })
        }
        return json(404, { error: 'not found' })
      } catch (error) {
        return json(500, { error: String(error?.message ?? error) })
      }
    },
  })
}
