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
 * 4 — added `/graph` (folder skeleton + memory edges).
 */
// Bumped whenever the client bundle changes shape: the client compares this
// against its own constant, and a mismatch is what forces the page to reload the
// module instead of silently running the previous build.
export const API_VERSION = 6

/**
 * @param {{
 *   webServer: { register(route: object): () => void },
 *   indexer: object,
 *   store: object,
 *   ocrStatus: () => Promise<object>,
 *   activity?: { since(id: number): object[], latestId(): number },
 *   memoryStatus?: () => object|null,
 *   graph?: { build(input: object): object },
 * }} deps
 */
export function registerUiRoutes({ webServer, indexer, store, ocrStatus, activity = null, memoryStatus = null, graph = null }) {
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
            memory: memoryStatus ? memoryStatus() : null,
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
        if (route === '/graph') {
          if (!graph) return json(503, { error: 'graph unavailable' })
          const focusParam = url.searchParams.get('focus')
          const payload = graph.build({
            roots: indexer.status().roots ?? [],
            focus: focusParam === null || focusParam === '' ? null : focusParam,
          })
          return json(200, { ...payload, apiVersion: API_VERSION })
        }
        return json(404, { error: 'not found' })
      } catch (error) {
        return json(500, { error: String(error?.message ?? error) })
      }
    },
  })
}
