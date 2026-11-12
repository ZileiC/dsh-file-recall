/**
 * dsh-file-recall client half.
 *
 * Hand-written browser bundle in the harness module format
 * (`window.__ModuleLoader__.load({ id, factory })`): no build tool, no
 * third-party dependency, `react` from the platform seed only.
 *
 * Surfaces:
 *  - `main` (keyed, key = "file-recall"): the recall panel.
 *  - `sidebar.panellist` (list, id = "file-recall"): the sidebar glyph.
 *
 * Data is read-only, from the host half's same-origin JSON routes under
 * `/api/file-recall/*`. The panel never mutates the index; changes go through
 * the model's tools and the skill's guidance.
 */
window.__ModuleLoader__.load({
  id: 'dsh-file-recall',
  factory(require) {
    const module = { exports: {} }

    let React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }
    if (React === null) {
      module.exports.inject = []
      module.exports.apply = function apply() {}
      return module.exports
    }

    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useCallback = React.useCallback

    const NS = 'dsh-file-recall'
    const ID = 'dsh-file-recall'
    const PANEL_ID = 'file-recall'
    // Must match API_VERSION in lib/ui-routes.js. A host that predates this
    // marker (or reports another number) is running an older module.
    const EXPECTED_API_VERSION = 4
    const API_ROOT = '/api/file-recall'
    const STYLE_ID = 'dsh-file-recall/client.css'
    const POLL_MS = 4000
    // Only while the page is visible, and only a few hundred bytes per tick.
    const ACTIVITY_POLL_MS = 1500
    const ACTIVITY_MAX = 24

    const DICT_ZH = {
      'panel.title': '文件记忆召回',
      'panel.subtitle': '按模糊描述找到文件与页',
      'panel.refresh': '刷新',
      'panel.refreshing': '刷新中',
      'panel.empty.title': '还没有建索引',
      'panel.empty.hint': '在对话里说：把这个文件夹建进索引 <path>',
      'panel.empty.action': '示例：帮我把 /Users/你/Documents/资料 建进索引',
      'panel.setup.title': '待建库',
      'metric.files': '文件',
      'metric.chunks': '片段',
      'metric.ocr': 'OCR 页',
      'metric.pending': '待处理',
      'metric.errors': '失败',
      'section.coverage': '索引覆盖',
      'section.ocr': 'OCR 通道',
      'section.recent': '最近纠正',
      'section.roots': '资料目录',
      'label.provider': '当前 provider',
      'label.fallback': '回退自',
      'label.updated': '最近同步',
      'label.greeting': '什么时候用我',
      'greeting.body': '你只记得零散细节：某年某个方案、某一页角落的一句话。说给我听，我去把文件和页码找出来，再把那页原文念给你确认。',
      'status.idle': '空闲',
      'status.pending': '有未处理文件',
      'status.error': '有失败文件',
      'status.ready': '已就绪',
      'ocr.vision': 'macOS Vision',
      'ocr.tesseract': 'Tesseract',
      'ocr.none': '未启用',
      'error.load': '读取索引状态失败',
      'error.network': '无法连接插件服务，确认插件已启用',
      'error.staleHost': '面板已更新，但运行中的插件还是旧版本：请完全退出并重启 DeepSeek Harness',
      'error.staleHost.short': '宿主插件版本过旧',
      'feedback.empty': '还没有纠正记录。找错过一次，我会记下来。',
      'feedback.hit': '找对了',
      'feedback.partial': '部分对',
      'feedback.wrong': '找错了',
      'unit.pages': '页',
      'live': '实时',
      'section.signal': '检索实况',
      'signal.hint': '在对话里说出你记得的任何细节，检索发生的那一刻这里会亮起来。',
      'signal.idle': '等待检索',
      'signal.hits': '处命中',
      'signal.noHit': '这一条没有命中任何页面',
      'signal.degraded': '扩写没参与，按原话检索',
      'signal.relaxed': '放宽了匹配条件',
      'signal.failed': '检索失败',
      'glyph.busy': '正在处理文件',
      'section.graph': '资料图谱',
      'graph.hint': '点文件夹看下一层；外面那些小点是检索记下的位置。',
      'graph.root': '全部资料',
      'graph.back': '返回上层',
      'graph.empty': '索引里还没有文件，图谱是空的。',
      'graph.error': '图谱读不出来，稍后重试',
      'graph.more': '还有 {n} 个未显示',
      'graph.files': '文件',
      'graph.chunks': '片段',
      'graph.scanned': '扫描件',
      'graph.memory': '检索记录',
      'graph.legend.hit': '找对了',
      'graph.legend.wrong': '没找到',
      'graph.legend.partial': '部分对',
      'graph.legend.unknown': '未结算',
    }

    const DICT_EN = {
      'panel.title': 'File Recall',
      'panel.subtitle': 'Find the file and page from a vague memory',
      'panel.refresh': 'Refresh',
      'panel.refreshing': 'Refreshing',
      'panel.empty.title': 'No index yet',
      'panel.empty.hint': 'In the conversation, ask: index this folder <path>',
      'panel.empty.action': 'Example: index /Users/you/Documents/archive',
      'panel.setup.title': 'Needs indexing',
      'metric.files': 'Files',
      'metric.chunks': 'Chunks',
      'metric.ocr': 'OCR pages',
      'metric.pending': 'Pending',
      'metric.errors': 'Failed',
      'section.coverage': 'Coverage',
      'section.ocr': 'OCR channel',
      'section.recent': 'Recent corrections',
      'section.roots': 'Folders',
      'label.provider': 'Active provider',
      'label.fallback': 'Fallback from',
      'label.updated': 'Last sync',
      'label.greeting': 'When to use me',
      'greeting.body': 'You remember fragments — a year, a plan, one line in the corner of a slide. Describe it and I find the file and the page, then read that page back so you can confirm.',
      'status.idle': 'Idle',
      'status.pending': 'Files waiting',
      'status.error': 'Failures',
      'status.ready': 'Ready',
      'ocr.vision': 'macOS Vision',
      'ocr.tesseract': 'Tesseract',
      'ocr.none': 'Off',
      'error.load': 'Could not read index status',
      'error.network': 'Plugin service unreachable; check that the plugin is enabled',
      'error.staleHost': 'The panel is newer than the running plugin: fully quit and restart DeepSeek Harness',
      'error.staleHost.short': 'Host plugin is stale',
      'feedback.empty': 'No corrections yet. Get one wrong and I will remember it.',
      'feedback.hit': 'Good match',
      'feedback.partial': 'Partly right',
      'feedback.wrong': 'Wrong match',
      'unit.pages': 'pages',
      'live': 'live',
      'section.signal': 'Live recall',
      'signal.hint': 'Describe any detail you remember in the conversation; this lights up the moment a search runs.',
      'signal.idle': 'Waiting for a search',
      'signal.hits': 'hits',
      'signal.noHit': 'Nothing matched this one',
      'signal.degraded': 'Expansion skipped; matched your words only',
      'signal.relaxed': 'Relaxed the match',
      'signal.failed': 'Search failed',
      'glyph.busy': 'Working on files',
      'section.graph': 'Archive graph',
      'graph.hint': 'Tap a folder to go deeper; the small dots outside are places a recall landed.',
      'graph.root': 'Everything',
      'graph.back': 'Back',
      'graph.empty': 'Nothing indexed yet, so the graph is empty.',
      'graph.error': 'Could not read the graph; try again shortly',
      'graph.more': '{n} more hidden',
      'graph.files': 'files',
      'graph.chunks': 'chunks',
      'graph.scanned': 'scanned',
      'graph.memory': 'Recalls',
      'graph.legend.hit': 'Found',
      'graph.legend.wrong': 'Missed',
      'graph.legend.partial': 'Partly',
      'graph.legend.unknown': 'Unsettled',
    }

    let clientCtx = null
    let boundT = null

    function warn(message, error) {
      try {
        console.warn('[dsh-file-recall] ' + message, error)
      } catch (failure) {
        /* console is best effort */
      }
    }

    function getT() {
      if (boundT) {
        return function translate(key, params) {
          try {
            const value = boundT(key, params)
            if (typeof value === 'string' && value.length > 0) return value
          } catch (failure) {
            /* fall through to the dictionary */
          }
          return (params && params.defaultValue) || key
        }
      }
      return function fallback(key, params) {
        return (params && params.defaultValue) || key
      }
    }

    /* ------------------------------------------------------------------ data */

    function fetchJson(path) {
      return fetch(API_ROOT + path, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
    }

    function useRecallStatus() {
      const [state, setState] = useState({ phase: 'loading', data: null, error: null })
      const [tick, setTick] = useState(0)

      const load = useCallback(function load() {
        let cancelled = false
        setState(function (previous) {
          return { phase: previous.data ? 'refreshing' : 'loading', data: previous.data, error: null }
        })
        fetchJson('/status')
          .then(function (data) {
            if (cancelled) return
            const hostVersion = typeof data.apiVersion === 'number' ? data.apiVersion : 0
            if (hostVersion !== EXPECTED_API_VERSION) {
              setState({
                phase: 'stale',
                data: data,
                error: new Error(
                  'host apiVersion ' + hostVersion + ' != panel ' + EXPECTED_API_VERSION,
                ),
              })
              return
            }
            setState({ phase: 'ready', data: data, error: null })
          })
          .catch(function (error) {
            if (cancelled) return
            setState(function (previous) {
              return { phase: 'error', data: previous.data, error: error }
            })
          })
        return function () {
          cancelled = true
        }
      }, [])

      useEffect(load, [load, tick])

      useEffect(
        function polling() {
          const id = window.setInterval(function () {
            if (document.hidden) return
            setTick(function (value) {
              return value + 1
            })
          }, POLL_MS)
          return function stop() {
            window.clearInterval(id)
          }
        },
        [],
      )

      return {
        state: state,
        refresh: function refresh() {
          setTick(function (value) {
            return value + 1
          })
        },
      }
    }

    function useRecent() {
      const [rows, setRows] = useState([])
      useEffect(function loadRecent() {
        let cancelled = false
        fetchJson('/recent')
          .then(function (data) {
            if (cancelled) return
            setRows(Array.isArray(data && data.feedback) ? data.feedback : [])
          })
          .catch(function () {
            /* the panel keeps its last known list */
          })
        return function () {
          cancelled = true
        }
      }, [])
      return rows
    }

    /* ------------------------------------------------------------- activity */

    /**
     * One shared poller for recall events.
     *
     * The panel and the sidebar glyph live in different React trees, so a
     * per-component poll would double the request rate and let the two disagree
     * about what just happened. Both subscribe here instead; polling starts with
     * the first subscriber and stops with the last.
     */
    const activityBus = {
      events: [],
      cursor: 0,
      timer: null,
      listeners: new Set(),
      cached: null,
      snapshot: function snapshot() {
        if (this.cached === null) this.cached = this.events.slice()
        return this.cached
      },
      ingest: function ingest(list) {
        let added = 0
        for (let index = 0; index < list.length; index += 1) {
          const event = list[index]
          if (!event || typeof event.id !== 'number') continue
          if (event.id <= this.cursor) continue
          this.cursor = event.id
          this.events.push(event)
          added += 1
        }
        while (this.events.length > ACTIVITY_MAX) this.events.shift()
        if (added > 0) {
          this.cached = null
          this.listeners.forEach(function notify(listener) {
            try {
              listener()
            } catch (failure) {
              warn('activity listener failed', failure)
            }
          })
        }
        return added
      },
      tick: function tick() {
        try {
          if (typeof document !== 'undefined' && document.hidden) return
        } catch (failure) {
          /* no document: keep polling */
        }
        fetchJson('/activity?since=' + activityBus.cursor)
          .then(function ingested(data) {
            if (data && Array.isArray(data.events)) activityBus.ingest(data.events)
          })
          .catch(function ignored() {
            /* presence is best effort; it must never surface as a panel error */
          })
      },
      subscribe: function subscribe(listener) {
        this.listeners.add(listener)
        if (this.timer === null) {
          this.timer = window.setInterval(function poll() {
            activityBus.tick()
          }, ACTIVITY_POLL_MS)
          this.tick()
        }
        return function unsubscribe() {
          activityBus.listeners.delete(listener)
          if (activityBus.listeners.size === 0 && activityBus.timer !== null) {
            window.clearInterval(activityBus.timer)
            activityBus.timer = null
          }
        }
      },
    }

    function useActivity() {
      const [events, setEvents] = useState(function initial() {
        return activityBus.snapshot()
      })
      useEffect(function subscribeActivity() {
        const sync = function sync() {
          setEvents(activityBus.snapshot())
        }
        const unsubscribe = activityBus.subscribe(sync)
        // The poller may already hold events from before this mount.
        sync()
        return unsubscribe
      }, [])
      return events
    }

    /* --------------------------------------------------------------- helpers */

    function formatTime(timestamp) {
      if (!timestamp) return '—'
      try {
        const date = new Date(Number(timestamp))
        if (Number.isNaN(date.getTime())) return '—'
        return new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(date)
      } catch (error) {
        return '—'
      }
    }

    function compactNumber(value) {
      const number = Number(value) || 0
      if (number < 1000) return String(number)
      if (number < 1_000_000) return (number / 1000).toFixed(number < 10_000 ? 1 : 0) + 'k'
      return (number / 1_000_000).toFixed(1) + 'M'
    }

    /** `a/b/c/deck.pptx` -> `c/deck.pptx`: enough to recognise, short enough to scan. */
    function shortenPath(path) {
      const parts = String(path ?? '').split(/[\\/]/).filter(Boolean)
      if (parts.length === 0) return '—'
      if (parts.length === 1) return parts[0]
      return parts.slice(-2).join('/')
    }

    function newestEvent(events) {
      return events.length === 0 ? null : events[events.length - 1]
    }

    function statusTone(data) {
      if (!data) return 'idle'
      if ((data.errors || 0) > 0) return 'error'
      if ((data.pending || 0) > 0) return 'pending'
      if ((data.files || 0) > 0) return 'ready'
      return 'idle'
    }

    /* ------------------------------------------------------------ components */

    function Dot(props) {
      return h('span', {
        className: 'dfr-dot dfr-dot-' + props.tone + (props.pulse ? ' dfr-dot-pulse' : ''),
        'aria-hidden': 'true',
      })
    }

    function Metric(props) {
      return h(
        'div',
        { className: 'dfr-metric', title: props.title || null },
        h('span', { className: 'dfr-metric-value' }, props.value),
        h('span', { className: 'dfr-metric-label' }, props.label),
      )
    }

    function Section(props) {
      return h(
        'section',
        { className: 'dfr-section' },
        h('h2', { className: 'dfr-section-title' }, props.title),
        props.children,
      )
    }

    function EmptyState(props) {
      const t = getT()
      return h(
        'div',
        { className: 'dfr-empty' },
        h('p', { className: 'dfr-empty-title' }, t('panel.empty.title')),
        h('p', { className: 'dfr-empty-hint' }, t('panel.empty.hint')),
        h('code', { className: 'dfr-empty-code' }, t('panel.empty.action')),
      )
    }

    /**
     * The "it is doing something" surface.
     *
     * Design intent: this archive is paper and ink, so the flourish is a single
     * ink sweep across the card, the expanded query terms surfacing word by word,
     * and each hit landing as a small ink bloom. One memorable element (the
     * sweep), everything else quiet. `key` is the event id: a newer search
     * re-mounts the card and the animation replays from the start instead of
     * finishing an animation about an older query.
     */
    function SignalPanel(props) {
      const t = getT()
      const event = props.event

      if (!event) {
        return h(
          'div',
          { className: 'dfr-signal dfr-signal-idle' },
          h('div', { className: 'dfr-signal-idle-dot', 'aria-hidden': 'true' }),
          h('p', { className: 'dfr-signal-hint' }, t('signal.hint')),
        )
      }

      const terms = Array.isArray(event.terms) ? event.terms : []
      const top = Array.isArray(event.top) ? event.top : []
      const failed = typeof event.error === 'string' && event.error.length > 0

      return h(
        'div',
        { className: 'dfr-signal', key: 'event-' + event.id },
        h('div', { className: 'dfr-signal-sweep', 'aria-hidden': 'true' }),
        h(
          'div',
          { className: 'dfr-signal-head' },
          h('span', { className: 'dfr-signal-query' }, event.query || '—'),
          h(
            'span',
            { className: 'dfr-signal-meta' },
            failed
              ? t('signal.failed')
              : String(event.hits) + ' ' + t('signal.hits') + ' · ' + String(event.ms) + ' ms',
          ),
        ),
        terms.length > 0
          ? h(
              'div',
              { className: 'dfr-terms' },
              terms.map(function termChip(term, index) {
                return h(
                  'span',
                  {
                    key: term + index,
                    className: 'dfr-term',
                    style: { animationDelay: 110 + index * 55 + 'ms' },
                  },
                  term,
                )
              }),
            )
          : null,
        top.length > 0
          ? h(
              'ul',
              { className: 'dfr-hits' },
              top.map(function hitRow(hit, index) {
                return h(
                  'li',
                  {
                    key: index,
                    className: 'dfr-hit',
                    style: { animationDelay: 260 + index * 80 + 'ms' },
                    title: hit.path || null,
                  },
                  h('span', { className: 'dfr-hit-bloom', 'aria-hidden': 'true' }),
                  h('span', { className: 'dfr-hit-loc' }, hit.locator || ''),
                  h('span', { className: 'dfr-hit-path' }, shortenPath(hit.path)),
                )
              }),
            )
          : failed
            ? null
            : h('p', { className: 'dfr-signal-note' }, t('signal.noHit')),
        failed ? h('p', { className: 'dfr-signal-note' }, String(event.error)) : null,
        event.degraded && !failed
          ? h(
              'p',
              { className: 'dfr-signal-note' },
              t('signal.degraded') +
                (event.degradedReason ? ' · ' + String(event.degradedReason) : ''),
            )
          : null,
        event.relaxed && !failed ? h('p', { className: 'dfr-signal-note' }, t('signal.relaxed')) : null,
      )
    }

    /* ----------------------------------------------------------------- graph */

    const GRAPH_W = 400
    const GRAPH_H = 290
    const GRAPH_MAX_NODES = 12
    const GRAPH_MAX_MEMORIES = 24

    function useGraph(focus) {
      const [state, setState] = useState({ phase: 'loading', data: null, error: null })
      useEffect(
        function loadGraph() {
          let cancelled = false
          setState(function (previous) {
            return { phase: previous.data ? 'refreshing' : 'loading', data: previous.data, error: null }
          })
          fetchJson('/graph' + (focus ? '?focus=' + encodeURIComponent(focus) : ''))
            .then(function (data) {
              if (cancelled) return
              setState({ phase: 'ready', data: data, error: null })
            })
            .catch(function (error) {
              if (cancelled) return
              setState(function (previous) {
                return { phase: 'error', data: previous.data, error: error }
              })
            })
          return function () {
            cancelled = true
          }
        },
        [focus],
      )
      return state
    }

    function outcomeTone(outcome) {
      if (outcome === 'hit') return 'hit'
      if (outcome === 'wrong') return 'wrong'
      if (outcome === 'partial') return 'partial'
      return 'unknown'
    }

    /**
     * Folder-first graph.
     *
     * A radial layout is used instead of a force simulation on purpose: the node
     * count per view is small and the radius is derived from the archive itself,
     * so positions are stable between renders (no drift, nothing to interrupt).
     * Memory appears as small satellites around the node a recall landed on,
     * coloured by the verdict — an unsettled recall stays grey, never green.
     */
    function GraphView() {
      const t = getT()
      const [focus, setFocus] = useState(null)
      const [selected, setSelected] = useState(null)
      const state = useGraph(focus)
      const data = state.data

      if (!data) {
        return h(
          'p',
          { className: 'dfr-hint' },
          state.phase === 'error' ? t('graph.error') : t('panel.refresh'),
        )
      }

      const allNodes = Array.isArray(data.nodes) ? data.nodes : []
      const hidden = Math.max(0, allNodes.length - GRAPH_MAX_NODES)
      const nodes = allNodes
        .slice()
        .sort(function byWeight(left, right) {
          return (right.files || right.chunks || 0) - (left.files || left.chunks || 0)
        })
        .slice(0, GRAPH_MAX_NODES)

      if (nodes.length === 0) {
        return h('p', { className: 'dfr-hint' }, t('graph.empty'))
      }

      const maxChunks = nodes.reduce(function max(sum, node) {
        return Math.max(sum, node.chunks || 0)
      }, 1)
      const cx = GRAPH_W / 2
      const cy = GRAPH_H / 2 - 6
      const rx = GRAPH_W * 0.34
      const ry = GRAPH_H * 0.3

      const placed = nodes.map(function place(node, index) {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / nodes.length
        const share = maxChunks > 0 ? Math.sqrt((node.chunks || 0) / maxChunks) : 0
        return {
          node: node,
          angle: angle,
          x: cx + rx * Math.cos(angle),
          y: cy + ry * Math.sin(angle),
          radius: 5 + 9 * Math.min(1, share),
        }
      })
      const byId = new Map(
        placed.map(function pair(entry) {
          return [entry.node.id, entry]
        }),
      )

      const memories = (Array.isArray(data.edges) ? data.edges : [])
        .filter(function drawable(edge) {
          return byId.has(edge.target)
        })
        .slice(-GRAPH_MAX_MEMORIES)
      const memoryDots = []
      const perTarget = new Map()
      for (const edge of memories) {
        const entry = byId.get(edge.target)
        const seen = perTarget.get(edge.target) ?? 0
        perTarget.set(edge.target, seen + 1)
        const jitter = (seen - 1.5) * 0.34
        const angle = entry.angle + jitter
        const distance = entry.radius + 9
        memoryDots.push({
          key: edge.id,
          x: entry.x + Math.cos(angle) * distance,
          y: entry.y + Math.sin(angle) * distance,
          tone: outcomeTone(edge.outcome),
          title: edge.query,
          targetId: edge.target,
        })
      }

      const selectedEntry = selected ? byId.get(selected) : null
      const current = selectedEntry ? selectedEntry.node : null

      function nodeLabel(node) {
        const name = String(node.name || '')
        return name.length > 9 ? name.slice(0, 8) + '…' : name
      }

      const svg = h(
        'svg',
        {
          className: 'dfr-graph',
          viewBox: '0 0 ' + GRAPH_W + ' ' + GRAPH_H,
          role: 'img',
          'aria-label': t('section.graph'),
        },
        placed.map(function spokes(entry) {
          return h('line', {
            key: 's' + entry.node.id,
            className: 'dfr-wire',
            x1: cx,
            y1: cy,
            x2: entry.x,
            y2: entry.y,
          })
        }),
        memoryDots.map(function wire(dot) {
          const entry = byId.get(dot.targetId)
          return h('line', {
            key: 'm' + dot.key,
            className: 'dfr-wire-memory',
            x1: entry.x,
            y1: entry.y,
            x2: dot.x,
            y2: dot.y,
          })
        }),
        h('circle', { className: 'dfr-groot', cx: cx, cy: cy, r: 9 }),
        h(
          'text',
          { className: 'dfr-groot-label', x: cx, y: cy + 24, textAnchor: 'middle' },
          data.focus ? String(data.focus).split(/[\\/]+/).pop() : t('graph.root'),
        ),
        placed.map(function nodeShape(entry) {
          const node = entry.node
          const isFolder = node.type === 'folder'
          return h(
            'g',
            {
              key: node.id,
              className: 'dfr-gnode' + (selected === node.id ? ' is-selected' : ''),
              tabIndex: 0,
              role: 'button',
              'aria-label': node.name,
              onClick: function onClick() {
                setSelected(node.id)
                if (isFolder) setFocus(node.rel)
              },
              onKeyDown: function onKeyDown(event) {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                setSelected(node.id)
                if (isFolder) setFocus(node.rel)
              },
            },
            h('circle', {
              className: isFolder ? 'dfr-gfolder' : 'dfr-gfile',
              cx: entry.x,
              cy: entry.y,
              r: entry.radius,
            }),
            h(
              'text',
              {
                className: 'dfr-glabel',
                x: entry.x,
                y: entry.y + entry.radius + 11,
                textAnchor: 'middle',
              },
              nodeLabel(node),
            ),
          )
        }),
        memoryDots.map(function dotShape(dot) {
          return h(
            'circle',
            {
              key: dot.key,
              className: 'dfr-gmemory dfr-gmemory-' + dot.tone,
              cx: dot.x,
              cy: dot.y,
              r: 2.4,
            },
            h('title', null, dot.title),
          )
        }),
      )

      const crumb = String(data.focus || '')
      return h(
        'div',
        { className: 'dfr-graph-wrap' },
        h(
          'div',
          { className: 'dfr-graph-bar' },
          data.focus
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dfr-btn dfr-btn-small',
                  onClick: function goBack() {
                    const parts = crumb.split(/[\\/]+/).filter(Boolean)
                    setSelected(null)
                    setFocus(parts.length > 1 ? parts.slice(0, -1).join('\\') : null)
                  },
                },
                '← ' + t('graph.back'),
              )
            : h('span', { className: 'dfr-graph-path' }, t('graph.root')),
          h('span', { className: 'dfr-graph-path' }, crumb),
        ),
        svg,
        h(
          'div',
          { className: 'dfr-legend' },
          h('span', { className: 'dfr-legend-item' }, h('i', { className: 'dfr-gmemory dfr-gmemory-hit' }), t('graph.legend.hit')),
          h('span', { className: 'dfr-legend-item' }, h('i', { className: 'dfr-gmemory dfr-gmemory-wrong' }), t('graph.legend.wrong')),
          h('span', { className: 'dfr-legend-item' }, h('i', { className: 'dfr-gmemory dfr-gmemory-partial' }), t('graph.legend.partial')),
          h('span', { className: 'dfr-legend-item' }, h('i', { className: 'dfr-gmemory dfr-gmemory-unknown' }), t('graph.legend.unknown')),
        ),
        current
          ? h(
              'p',
              { className: 'dfr-graph-detail' },
              h('strong', null, current.name),
              ' · ',
              current.type === 'folder'
                ? String(current.files || 0) + ' ' + t('graph.files')
                : String(current.kind || '') + ' · ' + String(current.chunks || 0) + ' ' + t('graph.chunks'),
              current.scanned
                ? ' · ' +
                  (current.type === 'folder' ? String(current.scanned) + ' ' : '') +
                  t('graph.scanned')
                : '',
            )
          : h('p', { className: 'dfr-hint' }, t('graph.hint')),
        hidden > 0
          ? h(
              'p',
              { className: 'dfr-hint' },
              String(t('graph.more')).replace('{n}', String(hidden)),
            )
          : null,
      )
    }

    function PanelBody(props) {
      const t = getT()
      const data = props.data
      const recent = props.recent
      const tone = statusTone(data)
      const isEmpty = !data || (data.files || 0) === 0

      if (isEmpty) {
        return h(EmptyState, null)
      }

      const ocr = data.ocr || {}
      const providerName =
        ocr.provider === 'vision'
          ? t('ocr.vision')
          : ocr.provider === 'tesseract'
            ? t('ocr.tesseract')
            : t('ocr.none')
      // Older host builds may not report these; the panel degrades gracefully.
      const ocrChunks = typeof data.ocrChunks === 'number' ? data.ocrChunks : null

      return h(
        'div',
        { className: 'dfr-body' },
        h(
          Section,
          { title: t('section.signal') },
          h(SignalPanel, { event: props.signal || null }),
        ),
        h(Section, { title: t('section.graph') }, h(GraphView, null)),
        h(
          'div',
          { className: 'dfr-metrics' },
          h(Metric, { value: compactNumber(data.files), label: t('metric.files') }),
          h(Metric, { value: compactNumber(data.chunks), label: t('metric.chunks') }),
          ocrChunks === null
            ? null
            : h(Metric, { value: compactNumber(ocrChunks), label: t('metric.ocr') }),
          h(Metric, { value: compactNumber(data.pending), label: t('metric.pending') }),
          h(Metric, {
            value: compactNumber(data.errors),
            label: t('metric.errors'),
            title: data.errors ? t('status.error') : t('status.ready'),
          }),
        ),
        h(
          Section,
          { title: t('section.coverage') },
          h(
            'dl',
            { className: 'dfr-rows' },
            h(
              'div',
              { className: 'dfr-row' },
              h('dt', null, t('label.updated')),
              h('dd', null, formatTime(data.lastSyncAt)),
            ),
            h(
              'div',
              { className: 'dfr-row' },
              h('dt', null, t('label.provider')),
              h(
                'dd',
                null,
                h(Dot, { tone: ocr.provider ? 'ready' : 'idle' }),
                providerName,
                ocr.fallbackFrom
                  ? h('span', { className: 'dfr-muted' }, ' · ' + t('label.fallback') + ' ' + ocr.fallbackFrom)
                  : null,
              ),
            ),
          ),
          Array.isArray(data.roots) && data.roots.length > 0
            ? h(
                'ul',
                { className: 'dfr-roots' },
                data.roots.map(function (root, index) {
                  return h(
                    'li',
                    { key: index, className: 'dfr-root' },
                    h('code', null, root),
                  )
                }),
              )
            : null,
        ),
        h(
          Section,
          { title: t('section.recent') },
          recent.length === 0
            ? h('p', { className: 'dfr-hint' }, t('feedback.empty'))
            : h(
                'ul',
                { className: 'dfr-feedback' },
                recent.map(function (row, index) {
                  const verdict = row.verdict || 'partial'
                  return h(
                    'li',
                    { key: row.id || index, className: 'dfr-feedback-row' },
                    h('span', { className: 'dfr-chip dfr-chip-' + verdict }, t('feedback.' + verdict)),
                    h('span', { className: 'dfr-feedback-query' }, row.query || row.path || ''),
                    row.correction
                      ? h('span', { className: 'dfr-feedback-fix' }, '→ ' + row.correction)
                      : null,
                  )
                }),
              ),
        ),
        h(
          'p',
          { className: 'dfr-greeting' },
          h('strong', null, t('label.greeting')),
          ' ',
          t('greeting.body'),
        ),
      )
    }

    function PanelPage() {
      const t = getT()
      const { state, refresh } = useRecallStatus()
      const recent = useRecent()
      const events = useActivity()
      const signal = newestEvent(events)
      const data = state.data
      const tone = statusTone(data)
      const busy = Boolean(data && (data.pending || 0) > 0)
      const statusLabel =
        tone === 'error'
          ? t('status.error')
          : tone === 'pending'
            ? t('status.pending')
            : tone === 'ready'
              ? t('status.ready')
              : state.phase === 'stale'
                ? t('error.staleHost.short')
                : t('status.idle')

      return h(
        'div',
        { className: 'dfr-page' },
        h(
          'header',
          { className: 'dfr-head' },
          h(
            'div',
            { className: 'dfr-head-text' },
            h('h1', { className: 'dfr-title' }, t('panel.title')),
            h('p', { className: 'dfr-sub' }, t('panel.subtitle')),
          ),
          h(
            'div',
            { className: 'dfr-head-actions' },
            h(
              'span',
              { className: 'dfr-status' },
              h(Dot, { tone: tone, pulse: busy }),
              statusLabel,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dfr-btn',
                disabled: state.phase === 'loading' || state.phase === 'refreshing',
                onClick: function onClick() {
                  refresh()
                },
                'aria-label': t('panel.refresh'),
              },
              state.phase === 'refreshing' ? t('panel.refreshing') : t('panel.refresh'),
            ),
          ),
        ),
        state.phase === 'loading'
          ? h('div', { className: 'dfr-loading' }, t('panel.refresh'))
          : state.phase === 'stale'
            ? h(
                'div',
                { className: 'dfr-error', role: 'alert' },
                h('p', null, t('error.staleHost')),
                h(
                  'code',
                  null,
                  String(state.error && state.error.message ? state.error.message : ''),
                ),
              )
            : state.error !== null
              ? h(
                  'div',
                  { className: 'dfr-error', role: 'alert' },
                  h('p', null, t('error.network')),
                  h('code', null, String(state.error && state.error.message ? state.error.message : '')),
                )
              : null,
        state.phase !== 'loading'
          ? h(PanelBody, { data: data, recent: recent, signal: signal })
          : null,
      )
    }

    function PanelIcon(props) {
      const active = !props || props.active !== false
      // A quiet presence mark: without it the sidebar gives no sign that a
      // recall just happened in the conversation. Keyed by event id so the ring
      // plays once per search and then stays gone, instead of pulsing forever.
      const events = useActivity()
      const newest = newestEvent(events)
      const mark = newest && newest.id ? newest.id : null
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: '16',
          height: '16',
          role: 'img',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', {
          key: 'doc',
          d: 'M3.2 2.2h6.1l3.5 3.5v8.1H3.2z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.2',
          strokeLinejoin: 'round',
          opacity: active ? '1' : '0.7',
        }),
        h('path', {
          key: 'fold',
          d: 'M9.3 2.2v3.5h3.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.2',
          strokeLinejoin: 'round',
        }),
        h('circle', {
          key: 'lens',
          cx: '7.4',
          cy: '9.2',
          r: '2.1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.2',
        }),
        h('path', {
          key: 'handle',
          d: 'M8.9 10.7l1.9 1.9',
          stroke: 'currentColor',
          strokeWidth: '1.2',
          strokeLinecap: 'round',
        }),
        mark === null
          ? null
          : h('circle', {
              key: 'pang' + mark,
              className: 'dfr-glyph-ping',
              cx: '12.6',
              cy: '3.4',
              r: '2.3',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: '1',
            }),
        mark === null
          ? null
          : h('circle', {
              key: 'pdot' + mark,
              className: 'dfr-glyph-dot',
              cx: '12.6',
              cy: '3.4',
              r: '1.5',
              fill: 'currentColor',
            }),
      )
    }

    /* --------------------------------------------------------------- styles */

    const CSS = [
      '.dfr-page{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;height:100%;min-height:100%;padding:24px clamp(16px,3vw,32px) 40px;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px;line-height:1.55}',
      '.dfr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.dfr-title{margin:0;font-size:19px;line-height:1.2;letter-spacing:-0.01em;font-weight:600}',
      '.dfr-sub{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-head-actions{display:flex;align-items:center;gap:10px}',
      '.dfr-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none;background:var(--dsw-alias-state-idle-primary)}',
      '.dfr-dot-ready{background:var(--dsw-alias-state-success-primary)}',
      '.dfr-dot-pending{background:var(--dsw-alias-state-warn-primary)}',
      '.dfr-dot-error{background:var(--dsw-alias-state-error-primary)}',
      '.dfr-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;height:28px;padding:0 12px;font:inherit;font-size:12px;cursor:pointer;transition:background 160ms ease,border-color 160ms ease}',
      '.dfr-btn:hover:not(:disabled){background:color-mix(in oklab,var(--dsw-alias-label-primary) 6%,transparent)}',
      '.dfr-btn:active:not(:disabled){transform:scale(0.98)}',
      '.dfr-btn:disabled{cursor:default;opacity:.6}',
      '.dfr-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dfr-body{display:flex;flex-direction:column;gap:20px}',
      '.dfr-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:10px;margin:0}',
      '.dfr-metric{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.dfr-metric-value{font-size:22px;line-height:1;letter-spacing:-0.02em;font-weight:600;font-variant-numeric:tabular-nums}',
      '.dfr-metric-label{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-section{display:flex;flex-direction:column;gap:8px}',
      '.dfr-section-title{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:0}',
      '.dfr-rows{display:flex;flex-direction:column;gap:6px;margin:0}',
      '.dfr-row{display:grid;grid-template-columns:minmax(96px,140px) 1fr;gap:12px;align-items:baseline}',
      '.dfr-row dt{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-row dd{margin:0;display:flex;align-items:center;gap:6px;font-size:12px;font-variant-numeric:tabular-nums}',
      '.dfr-roots{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}',
      '.dfr-root code,.dfr-empty-code{font-family:var(--ds-font-family-code);font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.dfr-empty{display:flex;flex-direction:column;gap:8px;padding:28px 20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}',
      '.dfr-empty-title{margin:0;font-size:14px;font-weight:600}',
      '.dfr-empty-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-empty-code{display:block;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}',
      '.dfr-feedback{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.dfr-feedback-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}',
      '.dfr-chip{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-chip-hit{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dfr-chip-partial{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}',
      '.dfr-chip-wrong{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dfr-feedback-query{color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46ch}',
      '.dfr-feedback-fix{color:var(--dsw-alias-label-secondary)}',
      '.dfr-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-greeting{margin:0;padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary)}',
      '.dfr-greeting strong{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dfr-loading{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-error{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-state-error-primary)}',
      '.dfr-error p{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}',
      '.dfr-error code{font-family:var(--ds-font-family-code);font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.dfr-muted{color:var(--dsw-alias-label-secondary)}',
      '.dfr-signal{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:9px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}',
      '.dfr-signal-idle{gap:10px}',
      '.dfr-signal-idle-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);opacity:.7}',
      '.dfr-signal-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-signal-sweep{position:absolute;inset:-60% -20%;pointer-events:none;transform-origin:50% 50%;background:conic-gradient(from 0deg,transparent 0deg,color-mix(in oklab,var(--dsw-alias-brand-primary) 16%,transparent) 26deg,transparent 56deg);animation:dfr-sweep 1500ms cubic-bezier(.22,.61,.36,1) 1 both}',
      '@keyframes dfr-sweep{0%{transform:rotate(-24deg);opacity:0}18%{opacity:1}100%{transform:rotate(336deg);opacity:0}}',
      '.dfr-signal-head{position:relative;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
      '.dfr-signal-query{margin:0;font-size:13px;font-weight:600;line-height:1.35;word-break:break-word}',
      '.dfr-signal-meta{margin-left:auto;font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dfr-terms{position:relative;display:flex;flex-wrap:wrap;gap:6px}',
      '.dfr-term{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-secondary);animation:dfr-term-in 420ms cubic-bezier(.2,.7,.3,1) both}',
      '@keyframes dfr-term-in{from{opacity:0;transform:translateY(5px) scale(.94)}to{opacity:1;transform:none}}',
      '.dfr-hits{position:relative;list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}',
      '.dfr-hit{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;animation:dfr-hit-in 460ms cubic-bezier(.2,.75,.3,1) both}',
      '@keyframes dfr-hit-in{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}',
      '.dfr-hit-bloom{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:dfr-bloom 900ms cubic-bezier(.2,.7,.3,1) both}',
      '@keyframes dfr-bloom{from{transform:scale(.2);opacity:.4}60%{transform:scale(1.25);opacity:1}to{transform:scale(1);opacity:1}}',
      '.dfr-hit-loc{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dfr-hit-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.dfr-signal-note{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.dfr-dot-pulse{animation:dfr-breathe 2600ms ease-in-out infinite}',
      '@keyframes dfr-breathe{0%,100%{opacity:.35}50%{opacity:1}}',
      '.dfr-glyph-ping{transform-box:fill-box;transform-origin:center;animation:dfr-ping 1500ms cubic-bezier(.2,.7,.3,1) 1 both}',
      '@keyframes dfr-ping{from{opacity:.85;transform:scale(.35)}to{opacity:0;transform:scale(2.3)}}',
      '.dfr-glyph-dot{opacity:.9}',
      '.dfr-graph-wrap{display:flex;flex-direction:column;gap:8px}',
      '.dfr-graph-bar{display:flex;align-items:center;gap:8px;min-height:26px}',
      '.dfr-btn-small{height:24px;padding:0 9px;font-size:11px;border-radius:7px}',
      '.dfr-graph-path{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dfr-graph{display:block;width:100%;height:auto;max-height:300px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:visible}',
      '.dfr-wire{stroke:var(--dsw-alias-border-l2);stroke-width:1}',
      '.dfr-wire-memory{stroke:var(--dsw-alias-border-l1);stroke-width:.8;stroke-dasharray:2 3}',
      '.dfr-groot{fill:var(--dsw-alias-label-primary)}',
      '.dfr-groot-label{fill:var(--dsw-alias-label-secondary);font-size:9px}',
      '.dfr-gfolder{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-label-secondary);stroke-width:1.2}',
      '.dfr-gfile{fill:var(--dsw-alias-bg-base);stroke:var(--dsw-alias-border-l2);stroke-width:1.2}',
      '.dfr-gnode{cursor:pointer;outline:none}',
      '.dfr-gnode:hover .dfr-gfolder,.dfr-gnode:hover .dfr-gfile{stroke:var(--dsw-alias-brand-primary)}',
      '.dfr-gnode:focus-visible .dfr-gfolder,.dfr-gnode:focus-visible .dfr-gfile{stroke:var(--dsw-alias-brand-primary);stroke-width:2.2}',
      '.dfr-gnode.is-selected .dfr-gfolder,.dfr-gnode.is-selected .dfr-gfile{stroke:var(--dsw-alias-brand-primary);stroke-width:2.2}',
      '.dfr-glabel{fill:var(--dsw-alias-label-secondary);font-size:8.5px;pointer-events:none}',
      '.dfr-gmemory{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}',
      '.dfr-gmemory-hit{fill:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-primary)}',
      '.dfr-gmemory-wrong{fill:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary)}',
      '.dfr-gmemory-partial{fill:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-primary)}',
      '.dfr-gmemory-unknown{fill:var(--dsw-alias-state-idle-primary);background:var(--dsw-alias-state-idle-primary);opacity:.8}',
      '.dfr-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-legend-item{display:inline-flex;align-items:center;gap:5px}',
      '.dfr-graph-detail{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.dfr-graph-detail strong{color:var(--dsw-alias-label-primary);font-weight:600}',
      '@media (prefers-reduced-motion: reduce){.dfr-btn{transition:none}.dfr-btn:active:not(:disabled){transform:none}.dfr-signal-sweep,.dfr-glyph-ping{display:none}.dfr-term,.dfr-hit,.dfr-hit-bloom,.dfr-dot-pulse{animation:none}.dfr-hit-bloom{opacity:1}}',
    ].join('\n')

    function ensureStyle() {
      if (typeof document === 'undefined') return function () {}
      const existing = document.getElementById(STYLE_ID)
      if (existing && existing.getAttribute('data-owner') === ID) {
        return function keep() {}
      }
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.setAttribute('data-owner', ID)
      element.textContent = CSS
      document.head.appendChild(element)
      return function remove() {
        if (element.parentNode) element.parentNode.removeChild(element)
      }
    }

    /* ------------------------------------------------------------ registration */

    function mountSlot(ctx, label, slotName, options, component, onRegistered) {
      try {
        ctx.effect(function () {
          try {
            return ctx.slots.inject(slotName, function () {
              try {
                const dispose = ctx.slots.register(options, component)
                if (typeof onRegistered === 'function') {
                  try {
                    onRegistered()
                  } catch (failure) {
                    warn(label + ' onRegistered failed', failure)
                  }
                }
                return dispose
              } catch (failure) {
                warn(label + ' registration refused', failure)
                return function () {}
              }
            })
          } catch (failure) {
            warn(label + ' inject failed', failure)
            return function () {}
          }
        }, 'file-recall: ' + label)
      } catch (failure) {
        warn(label + ' mount failed', failure)
      }
    }

    function apply(ctx) {
      clientCtx = ctx
      try {
        if (ctx.locale && typeof ctx.locale.bind === 'function') boundT = ctx.locale.bind(NS)
      } catch (failure) {
        warn('locale bind failed', failure)
      }
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(function () {
            return ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN })
          }, 'file-recall: dictionaries')
        }
      } catch (failure) {
        warn('dictionary registration failed', failure)
      }
      try {
        ctx.effect(function () {
          return ensureStyle()
        }, 'file-recall: styles')
      } catch (failure) {
        warn('style injection failed', failure)
      }

      mountSlot(
        ctx,
        'main',
        'main',
        {
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: function () {
            return {}
          },
        },
        PanelPage,
        function () {
          mountSlot(
            ctx,
            'panellist',
            'sidebar.panellist',
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 36,
              locale: NS,
              label: function () {
                return getT()('panel.title')
              },
            },
            PanelIcon,
          )
        },
      )
    }

    module.exports.inject = ['slots', 'locale']
    module.exports.apply = apply
    module.exports.name = PANEL_ID
    return module.exports
  },
})
