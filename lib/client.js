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
    const useRef = React.useRef

    const NS = 'dsh-file-recall'
    const ID = 'dsh-file-recall'
    const PANEL_ID = 'file-recall'
    // Must match API_VERSION in lib/ui-routes.js. A host that predates this
    // marker (or reports another number) is running an older module.
    const EXPECTED_API_VERSION = 5
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
      'signal.reduced': '系统关闭了动效，这里只显示静态结果',
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
      'dock.dismiss': '关闭这条检索提示',
      'tv.title': '资料检索',
      'tv.searching': '检索中…',
      'tv.failed': '检索失败',
      'tv.hits': '处命中',
      'tv.noHit': '这次没有命中',
      'tv.degraded': '扩写没参与，按原话检索',
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
      'signal.reduced': 'Motion is off in your system settings, so this shows the static result',
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
      'dock.dismiss': 'Dismiss this recall notice',
      'tv.title': 'Archive search',
      'tv.searching': 'Searching…',
      'tv.failed': 'Search failed',
      'tv.hits': 'hits',
      'tv.noHit': 'Nothing matched',
      'tv.degraded': 'Expansion skipped; matched your words only',
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
      // False until the first successful fetch settled. A consumer that mounts
      // before that must not treat the arriving history as a live event — that
      // is exactly how the strip used to replay an old recall on every open.
      loaded: false,
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
        const firstSettle = !this.loaded
        if (firstSettle) this.loaded = true
        if (added > 0 || firstSettle) {
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
                return h('span', { key: term + index, className: 'dfr-term' }, term)
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
                  { key: index, className: 'dfr-hit', title: hit.path || null },
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

    /* ------------------------------------------------------------ chat view */

    function toolResultText(block) {
      if (!block || typeof block !== 'object') return ''
      const parts = []
      const content = block.content
      if (Array.isArray(content)) {
        for (const piece of content) {
          if (piece && piece.type === 'text' && typeof piece.text === 'string') parts.push(piece.text)
        }
      }
      // Tolerate the other shapes a tool result may arrive in; the point is to
      // read the payload, not to assume one envelope.
      for (const key of ['text', 'output', 'result', 'payload']) {
        const value = block[key]
        if (typeof value === 'string') parts.push(value)
        else if (value && typeof value === 'object' && parts.length === 0) {
          try {
            parts.push(JSON.stringify(value))
          } catch (failure) {
            /* skip */
          }
        }
      }
      return parts.join('\n').trim()
    }

    /**
     * Always-visible recall strip above the composer.
     *
     * The tool-row view can be collapsed to a thin line (or not rendered at all),
     * which is why the animation went unseen. This seat is in the conversation and
     * cannot be missed: it appears the moment a search event lands, sweeps once,
     * lists the expanded terms and the hits, then folds away after a few seconds.
     */
    function ChatDock(props) {
      const t = getT()
      const events = useActivity()
      const newest = newestEvent(events)
      const sessionId =
        props && typeof props.sessionId === 'string'
          ? props.sessionId
          : props && props.session && typeof props.session.id === 'string'
            ? props.session.id
            : null
      // Everything the bus already holds is history: a conversation must not
      // replay a recall that happened before it was opened. The baseline can only
      // be taken once the first fetch has SETTLED — taking it earlier records 0
      // and then treats the arriving history as brand new.
      const busReady = activityBus.loaded
      const [baseline, setBaseline] = useState(undefined)
      const [shownId, setShownId] = useState(null)
      const [dismissedId, setDismissedId] = useState(null)

      useEffect(
        function captureBaseline() {
          if (baseline !== undefined) return
          if (!busReady) return
          setBaseline(newest && typeof newest.id === 'number' ? newest.id : 0)
        },
        [newest, baseline, busReady],
      )

      useEffect(
        function showLiveEvent() {
          if (baseline === undefined) return undefined
          if (!newest || typeof newest.id !== 'number') return undefined
          if (newest.id <= baseline) return undefined
          if (sessionId && newest.sessionId && newest.sessionId !== sessionId) return undefined
          if (newest.id === dismissedId) return undefined
          setShownId(newest.id)
          const timer = window.setTimeout(function hide() {
            setShownId(function current(value) {
              return value === newest.id ? null : value
            })
          }, DOCK_VISIBLE_MS)
          return function clear() {
            window.clearTimeout(timer)
          }
        },
        [newest, baseline, sessionId, dismissedId],
      )

      if (!newest || baseline === undefined) return null
      if (typeof newest.id !== 'number' || newest.id <= baseline) return null
      if (shownId !== newest.id) return null
      if (dismissedId === newest.id) return null

      const hits = Array.isArray(newest.top) ? newest.top : []
      const top = hits[0] || null
      const failed = typeof newest.error === 'string' && newest.error.length > 0
      const count = Number(newest.hits) || 0

      function dismiss() {
        setDismissedId(newest.id)
        setShownId(null)
      }

      // Two fixed lines: nothing expands or collapses, so the composer never
      // moves and the animation needs no replay control. It raises once for a
      // live recall in this conversation, then folds away on its own; the close
      // button is only for getting rid of it sooner.
      return h(
        'div',
        {
          className: 'dfr-dock',
          key: 'dock-' + newest.id,
        },
        h('span', { className: 'dfr-dock-scan', 'aria-hidden': 'true' }),
        h(
          'div',
          { className: 'dfr-dock-line dfr-dock-line-1' },
          h('span', { className: 'dfr-dock-label' }, t('tv.title')),
          h('span', { className: 'dfr-dock-query' }, newest.query || '—'),
          h(
            'span',
            { className: 'dfr-dock-count' },
            failed
              ? t('tv.failed')
              : String(count) + ' ' + t('tv.hits') + ' · ' + String(newest.ms || 0) + ' ms',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dfr-dock-close',
              onClick: dismiss,
              'aria-label': t('dock.dismiss'),
              title: t('dock.dismiss'),
            },
            h(
              'svg',
              {
                viewBox: '0 0 12 12',
                width: '10',
                height: '10',
                'aria-hidden': 'true',
                focusable: 'false',
              },
              h('path', {
                d: 'M2.5 2.5l7 7M9.5 2.5l-7 7',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: '1.3',
                strokeLinecap: 'round',
              }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dfr-dock-line dfr-dock-line-2' },
          top
            ? h(
                'span',
                { className: 'dfr-dock-hit', title: top.path || null },
                h('span', { className: 'dfr-dock-loc' }, top.locator || ''),
                shortenPath(top.path),
              )
            : h('span', { className: 'dfr-dock-empty' }, failed ? newest.error : t('tv.noHit')),
        ),
      )
    }

    /**
     * A render error inside one tool row must not take the transcript down.
     * React only catches render errors in class components.
     */
    class RecallToolBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error: error }
      }

      componentDidCatch(error) {
        warn('chat tool view render failed', error)
      }

      render() {
        if (this.state.error) {
          return h('div', { className: 'dfr-tv dfr-tv-broken' }, '资料检索视图出错')
        }
        return this.props.children
      }
    }

    /**
     * The recall animation lives HERE, in the conversation, not in the side panel:
     * the moment the model runs a search is the moment the person is looking at
     * the chat. The host tool view gets the call phase and its result JSON, so the
     * card can sweep while it runs and then settle on the matches.
     */
    function RecallToolView(props) {
      const t = getT()
      const phase = props && props.phase ? props.phase : 'result'
      const block = (props && props.block) || {}

      const text = phase === 'result' ? toolResultText(block) : ''
      let payload = null
      if (text) {
        try {
          payload = JSON.parse(text)
        } catch (failure) {
          payload = null
        }
      }

      const failed = block.isError === true || (phase === 'result' && text !== '' && payload === null)
      const query = payload && typeof payload.query === 'string' ? payload.query : ''
      const terms = payload && Array.isArray(payload.expandedTerms) ? payload.expandedTerms : []
      const hits = payload && Array.isArray(payload.hits) ? payload.hits : []
      const degraded = Boolean(payload && payload.degraded)

      const head = h(
        'div',
        { className: 'dfr-tv-head' },
        h('span', { className: 'dfr-tv-title' }, t('tv.title')),
        query ? h('span', { className: 'dfr-tv-query' }, query) : null,
        h(
          'span',
          { className: 'dfr-tv-meta' },
          phase !== 'result'
            ? t('tv.searching')
            : failed
              ? t('tv.failed')
              : String(hits.length) + ' ' + t('tv.hits'),
        ),
      )

      return h(
        'div',
        { className: 'dfr-tv' + (failed ? ' dfr-tv-failed' : ''), key: 'tv-' + (props.callId || 'x') },
        h('div', { className: 'dfr-signal-sweep', 'aria-hidden': 'true' }),
        head,
        terms.length > 0
          ? h(
              'div',
              { className: 'dfr-terms' },
              terms.slice(0, 8).map(function termChip(term, index) {
                return h('span', { key: term + index, className: 'dfr-term' }, term)
              }),
            )
          : null,
        hits.length > 0
          ? h(
              'ul',
              { className: 'dfr-hits' },
              hits.slice(0, 3).map(function hitRow(hit, index) {
                return h(
                  'li',
                  { key: index, className: 'dfr-hit', title: hit.path || null },
                  h('span', { className: 'dfr-hit-bloom', 'aria-hidden': 'true' }),
                  h('span', { className: 'dfr-hit-loc' }, hit.locator || ''),
                  h('span', { className: 'dfr-hit-path' }, shortenPath(hit.path)),
                )
              }),
            )
          : phase === 'result' && !failed
            ? h('p', { className: 'dfr-signal-note' }, t('tv.noHit'))
            : null,
        degraded && !failed ? h('p', { className: 'dfr-signal-note' }, t('tv.degraded')) : null,
        failed && text ? h('p', { className: 'dfr-signal-note' }, text.slice(0, 200)) : null,
      )
    }

    /* ----------------------------------------------------------------- graph */

    // The canvas is deliberately tall. At 430px the panel's own max-height clamped
// the drawing, the aspect ratio flattened every ring, and nodes + memory dots had
// nowhere to go but on top of each other. More vertical room is the cheapest fix
// for crowding: it separates the rings without shrinking any label.
const GRAPH_H = 620
    // Rings are fractions of the available half-width, so the drawing uses the
    // real panel width instead of a fixed 460px box in a much wider column.
    // Rings are spaced wide enough that a level-2 node and its label never lands in
// the lane a memory dot needs (that collision was reported twice).
const GRAPH_RING_FRACTIONS = [0.34, 0.67, 1]
    const GRAPH_MAX_NODES = 48
    const GRAPH_MAX_MEMORIES = 28
    // How long a live recall stays on screen before it folds away by itself.
    const DOCK_VISIBLE_MS = 12_000

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
      const wrapRef = useRef(null)
      const [box, setBox] = useState({ width: 960, height: GRAPH_H })

      // The drawing must fit the column it is given (the main panel can be very
      // wide), and follow live resizes.
      useEffect(
        function measure() {
          const element = wrapRef.current
          if (!element) return undefined
          const update = function update() {
            const width = Math.max(420, Math.round(element.clientWidth || 960))
            setBox(function (previous) {
              return previous.width === width ? previous : { width: width, height: GRAPH_H }
            })
          }
          update()
          if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(update)
            observer.observe(element)
            return function stop() {
              observer.disconnect()
            }
          }
          return undefined
        },
        [],
      )

      if (!data) {
        return h(
          'div',
          { ref: wrapRef, className: 'dfr-graph-wrap' },
          h('p', { className: 'dfr-hint' }, state.phase === 'error' ? t('graph.error') : t('panel.refresh')),
        )
      }

      const allNodes = Array.isArray(data.nodes) ? data.nodes : []
      const nodes = allNodes.slice(0, GRAPH_MAX_NODES)

      if (nodes.length === 0) {
        return h('p', { className: 'dfr-hint' }, t('graph.empty'))
      }

      const cx = box.width / 2
      const cy = box.height / 2
      const rx = Math.max(150, box.width / 2 - 140)
      const ry = Math.max(120, box.height / 2 - 78)
      const weight = function weight(node) {
        return node.files || node.chunks || (node.type === 'folder' ? 1 : 0)
      }

      // Group by level, then by parent, so children fan inside their parent's
      // angular slice. The root's slice is the whole circle — applying the
      // child rule to it was what crammed all 16 folders into one thin wedge.
      const levels = []
      for (const node of nodes) {
        const index = Math.max(1, Math.min(3, node.depth || 1)) - 1
        if (!levels[index]) levels[index] = []
        levels[index].push(node)
      }
      const heaviest = (left, right) => weight(right) - weight(left)
      const angleOf = new Map()
      const sliceOf = new Map()
      const placed = []

      for (let level = 0; level < levels.length; level += 1) {
        const group = (levels[level] || []).slice().sort(heaviest)
        if (group.length === 0) continue
        const fraction = GRAPH_RING_FRACTIONS[Math.min(level, GRAPH_RING_FRACTIONS.length - 1)]
        const byParent = new Map()
        for (const node of group) {
          const key = node.parentRel || '__root__'
          if (!byParent.has(key)) byParent.set(key, [])
          byParent.get(key).push(node)
        }
        for (const [key, children] of byParent) {
          const parentAngle = key === '__root__' ? null : angleOf.get(key)
          const parentSlice = key === '__root__' ? null : sliceOf.get(key)
          // Root: full circle. Else: the parent's own slice, inset a little.
          const span = parentAngle == null ? Math.PI * 2 : parentSlice * 0.94
          const step = span / children.length
          const start = parentAngle == null ? -Math.PI / 2 : parentAngle - span / 2
          children.forEach(function child(node, index) {
            const angle = start + (index + 0.5) * step
            const share = Math.max(0.0001, weight(node))
            const scale = level === 0 ? 13 : level === 1 ? 7 : 3.6
            const base = level === 0 ? 7 : level === 1 ? 4 : 2.2
            placed.push({
              node: node,
              level: level,
              angle: angle,
              x: cx + rx * fraction * Math.cos(angle),
              y: cy + ry * fraction * Math.sin(angle),
              radius: base + scale * Math.min(1, Math.sqrt(share / 120)),
            })
            angleOf.set(node.rel, angle)
            sliceOf.set(node.rel, step)
          })
        }
      }

      const byId = new Map(
        placed.map(function pair(entry) {
          return [entry.node.id, entry]
        }),
      )
      const byRel = new Map(
        placed.map(function pairRel(entry) {
          return [entry.node.rel, entry]
        }),
      )
      const hidden = data.hidden && typeof data.hidden === 'object' ? data.hidden : null

      const memories = (Array.isArray(data.edges) ? data.edges : [])
        .filter(function drawable(edge) {
          return byId.has(edge.target)
        })
        .slice(-GRAPH_MAX_MEMORIES)
      // Memory satellites must never touch a node — theirs or anyone else's.
      //
      // Placement is a collision problem, not a radius constant: start outside
      // the owning node and walk outward until the dot clears every node circle
      // and every dot already placed. Overlap is what the user objected to, so it
      // is prevented by geometry instead of by z-order.
      const MEMORY_R = 3
      const clearOfNodes = function clearOfNodes(x, y) {
        for (const entry of placed) {
          const dx = x - entry.x
          const dy = y - entry.y
          if (Math.hypot(dx, dy) < entry.radius + MEMORY_R + 7) return false
        }
        return true
      }
      const clearOfDots = function clearOfDots(x, y) {
        for (const dot of memoryDots) {
          if (Math.hypot(x - dot.x, y - dot.y) < MEMORY_R * 2 + 6) return false
        }
        return true
      }
      const memoryDots = []
      const perTarget = new Map()
      for (const edge of memories) {
        const entry = byId.get(edge.target)
        const seen = perTarget.get(edge.target) ?? 0
        perTarget.set(edge.target, seen + 1)
        let placedDot = null
        // Fan siblings around the outward direction, then push until clear.
        for (let attempt = 0; attempt < 40 && !placedDot; attempt += 1) {
          const fan = (seen - 1) * 0.24 + attempt * 0.14
          const angle = entry.angle + fan
          const distance = entry.radius + 14 + attempt * 5
          const x = entry.x + Math.cos(angle) * distance
          const y = entry.y + Math.sin(angle) * distance
          if (x < 10 || y < 10 || x > box.width - 10 || y > GRAPH_H - 10) continue
          if (!clearOfNodes(x, y) || !clearOfDots(x, y)) continue
          placedDot = { key: edge.id, x, y, tone: outcomeTone(edge.outcome), title: edge.query, targetId: edge.target }
        }
        if (placedDot) memoryDots.push(placedDot)
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
          viewBox: '0 0 ' + box.width + ' ' + GRAPH_H,
          role: 'img',
          'aria-label': t('section.graph'),
        },
        placed.map(function branch(entry) {
          const parent = entry.node.parentRel ? byRel.get(entry.node.parentRel) : null
          const fromX = parent ? parent.x : cx
          const fromY = parent ? parent.y : cy
          // Arc-shaped mind-map wire.
          //
          // History: the first version put both control points ON the chord
          // (`fromX + (x-fromX)*k`), and a cubic Bézier whose control points are
          // colinear with its endpoints IS the straight segment — which is why it
          // still looked like spokes. The control point now sits at the chord's
          // midpoint offset along its normal, so every wire is a real arc with a
          // consistent bend, and the two sides of the fan mirror each other.
          const spanX = entry.x - fromX
          const spanY = entry.y - fromY
          const distance = Math.hypot(spanX, spanY) || 1
          const bend = Math.min(38, distance * 0.34)
          const normalX = -spanY / distance
          const normalY = spanX / distance
          const side = entry.angle >= -Math.PI / 2 ? 1 : -1
          const controlX = (fromX + entry.x) / 2 + normalX * bend * side
          const controlY = (fromY + entry.y) / 2 + normalY * bend * side
          return h('path', {
            key: 's' + entry.node.id,
            className: 'dfr-wire dfr-wire-d' + entry.level,
            d: `M${fromX} ${fromY} Q${controlX} ${controlY} ${entry.x} ${entry.y}`,
            fill: 'none',
          })
        }),
        memoryDots.map(function wire(dot) {
          const entry = byId.get(dot.targetId)
          // Short leaf curve from the node edge to the satellite.
          return h('path', {
            key: 'm' + dot.key,
            className: 'dfr-wire-memory',
            d: `M${entry.x} ${entry.y} Q${(entry.x + dot.x) / 2} ${(entry.y + dot.y) / 2 - 4} ${dot.x} ${dot.y}`,
            fill: 'none',
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
          // Labels only where they stay legible: the outer rings get tooltips.
          const showLabel = entry.level === 0 || (entry.level === 1 && (levels[1] || []).length <= 14)
          return h(
            'g',
            {
              key: node.id,
              className:
                'dfr-gnode dfr-gnode-d' + entry.level + (selected === node.id ? ' is-selected' : ''),
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
            showLabel
              ? h(
                  'text',
                  {
                    className: 'dfr-glabel dfr-glabel-d' + entry.level,
                    x: entry.x,
                    y: entry.y + entry.radius + 10,
                    textAnchor: 'middle',
                  },
                  nodeLabel(node),
                )
              : h('title', null, node.name),
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
              r: 3,
            },
            h('title', null, dot.title),
          )
        }),
      )

      const hiddenTotal = hidden
        ? Object.keys(hidden).reduce(function sum(total, key) {
            return total + (Number(hidden[key]) || 0)
          }, 0)
        : 0
      const hiddenText =
        hiddenTotal > 0
          ? h(
              'p',
              { className: 'dfr-hint' },
              String(t('graph.more')).replace('{n}', String(hiddenTotal)),
            )
          : null

      const crumb = String(data.focus || '')
      return h(
        'div',
        { ref: wrapRef, className: 'dfr-graph-wrap' },
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
          // Build marker: lets the user (and me) tell at a glance which bundle
          // the page is actually running after an update.
          h('span', { className: 'dfr-build' }, 'v' + EXPECTED_API_VERSION),
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
        hiddenText,
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
      '.dfr-metric-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-section{display:flex;flex-direction:column;gap:8px}',
      '.dfr-section-title{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:0}',
      '.dfr-rows{display:flex;flex-direction:column;gap:6px;margin:0}',
      '.dfr-row{display:grid;grid-template-columns:minmax(96px,140px) 1fr;gap:12px;align-items:baseline}',
      '.dfr-row dt{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-row dd{margin:0;display:flex;align-items:center;gap:6px;font-size:12px;font-variant-numeric:tabular-nums}',
      '.dfr-roots{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}',
      '.dfr-root code,.dfr-empty-code{font-family:var(--ds-font-family-code);font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.dfr-empty{display:flex;flex-direction:column;gap:8px;padding:28px 20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}',
      '.dfr-empty-title{margin:0;font-size:14px;font-weight:600}',
      '.dfr-empty-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-empty-code{display:block;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}',
      '.dfr-feedback{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.dfr-feedback-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}',
      '.dfr-chip{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-secondary)}',
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
      '.dfr-error code{font-family:var(--ds-font-family-code);font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.dfr-muted{color:var(--dsw-alias-label-secondary)}',
      '.dfr-signal{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:9px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}',
      '.dfr-signal-idle{gap:10px}',
      '.dfr-signal-idle-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);opacity:.7}',
      '.dfr-signal-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-signal-sweep{position:absolute;left:0;top:0;height:1px;width:34%;pointer-events:none;background:var(--dsw-alias-brand-primary);opacity:0;transform:translateX(-140%);will-change:transform,opacity;animation:dfr-scan 900ms cubic-bezier(.16,.84,.44,1) 60ms 1 both}',
      '.dfr-signal-head{position:relative;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
      '.dfr-signal-query{margin:0;font-size:13px;font-weight:600;line-height:1.35;word-break:break-word}',
      '.dfr-signal-meta{margin-left:auto;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dfr-terms{position:relative;display:flex;flex-wrap:wrap;gap:6px}',
      '.dfr-term{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-secondary);animation:dfr-term-in 420ms cubic-bezier(.2,.7,.3,1) both}',
      '@keyframes dfr-term-in{from{opacity:0;transform:translateY(5px) scale(.94)}to{opacity:1;transform:none}}',
      '.dfr-hits{position:relative;list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}',
      '.dfr-hit{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;animation:dfr-hit-in 460ms cubic-bezier(.2,.75,.3,1) both}',
      '@keyframes dfr-hit-in{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}',
      '.dfr-hit-bloom{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:dfr-bloom 900ms cubic-bezier(.2,.7,.3,1) both}',
      '@keyframes dfr-bloom{from{transform:scale(.2);opacity:.4}60%{transform:scale(1.25);opacity:1}to{transform:scale(1);opacity:1}}',
      '.dfr-hit-loc{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dfr-hit-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.dfr-signal-note{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.dfr-dot-pulse{animation:dfr-breathe 2600ms ease-in-out infinite}',
      '@keyframes dfr-breathe{0%,100%{opacity:.35}50%{opacity:1}}',
      '.dfr-glyph-ping{transform-box:fill-box;transform-origin:center;animation:dfr-ping 1500ms cubic-bezier(.2,.7,.3,1) 1 both}',
      '@keyframes dfr-ping{from{opacity:.85;transform:scale(.35)}to{opacity:0;transform:scale(2.3)}}',
      '.dfr-glyph-dot{opacity:.9}',
      '.dfr-graph-wrap{display:flex;flex-direction:column;gap:8px}',
      '.dfr-graph-bar{display:flex;align-items:center;gap:8px;min-height:26px}',
      '.dfr-btn-small{height:24px;padding:0 9px;font-size:12px;border-radius:7px}',
      '.dfr-graph-path{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dfr-graph{display:block;width:100%;height:auto;max-height:620px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:visible}',
      '.dfr-wire{stroke:var(--dsw-alias-border-l2);stroke-width:1;stroke-linecap:round}',
      '.dfr-wire-d2{stroke-width:.9;opacity:.8}',
      '.dfr-wire-d3{stroke-width:.7;opacity:.55}',
      '.dfr-wire-memory{stroke:var(--dsw-alias-border-l1);stroke-width:.9;stroke-dasharray:2 3}',
      '.dfr-groot{fill:var(--dsw-alias-label-primary)}',
      '.dfr-groot-label{fill:var(--dsw-alias-label-secondary);font-size:11px}',
      '.dfr-gfolder{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-label-secondary);stroke-width:1.2}',
      '.dfr-gfile{fill:var(--dsw-alias-bg-base);stroke:var(--dsw-alias-border-l2);stroke-width:1.2}',
      '.dfr-gnode{cursor:pointer;outline:none}',
      '.dfr-gnode:hover .dfr-gfolder,.dfr-gnode:hover .dfr-gfile{stroke:var(--dsw-alias-brand-primary)}',
      '.dfr-gnode:focus-visible .dfr-gfolder,.dfr-gnode:focus-visible .dfr-gfile{stroke:var(--dsw-alias-brand-primary);stroke-width:2.2}',
      '.dfr-gnode.is-selected .dfr-gfolder,.dfr-gnode.is-selected .dfr-gfile{stroke:var(--dsw-alias-brand-primary);stroke-width:2.2}',
      '.dfr-glabel{fill:var(--dsw-alias-label-secondary);font-size:11px;pointer-events:none}',
      '.dfr-glabel-d1{font-size:12px;fill:var(--dsw-alias-label-primary)}',
      '.dfr-glabel-d2{font-size:8px}',
      '.dfr-gnode-d3 .dfr-gfolder,.dfr-gnode-d3 .dfr-gfile{opacity:.85}',
      '.dfr-gmemory{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);stroke:var(--dsw-alias-bg-base);stroke-width:.9}',
      '.dfr-gmemory-hit{fill:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-primary)}',
      '.dfr-gmemory-wrong{fill:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary)}',
      '.dfr-gmemory-partial{fill:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-primary)}',
      '.dfr-gmemory-unknown{fill:var(--dsw-alias-state-idle-primary);background:var(--dsw-alias-state-idle-primary);opacity:.8}',
      '.dfr-build{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary);opacity:.75}',
      '.dfr-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-legend-item{display:inline-flex;align-items:center;gap:5px}',
      '.dfr-graph-detail{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.dfr-graph-detail strong{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dfr-tv{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:8px;margin:6px 0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.5;text-align:left}',
      '.dfr-tv-failed{border-color:var(--dsw-alias-state-error-primary)}',
      '.dfr-tv-broken{padding:10px 12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-tv-head{position:relative;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dfr-tv-title{flex:none;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.01em}',
      '.dfr-tv-query{min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-word}',
      '.dfr-tv-meta{margin-left:auto;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dfr-dock{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:2px;margin:0 0 8px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.45;animation:dfr-dock-in 260ms cubic-bezier(.22,1,.36,1) both}',
      '@keyframes dfr-dock-in{from{opacity:0;transform:translateY(5px) scale(.996)}to{opacity:1;transform:none}}',
      '.dfr-dock-scan{position:absolute;left:0;top:0;height:1px;width:34%;pointer-events:none;background:var(--dsw-alias-brand-primary);opacity:0;transform:translateX(-140%);will-change:transform,opacity;animation:dfr-scan 900ms cubic-bezier(.16,.84,.44,1) 60ms 1 both}',
      '@keyframes dfr-scan{0%{opacity:0;transform:translateX(-140%)}18%{opacity:.85}72%{opacity:.5}100%{opacity:0;transform:translateX(320%)}}',
      '.dfr-dock-line{display:flex;align-items:baseline;gap:8px;min-width:0}',
      '.dfr-dock-line-2{opacity:0;animation:dfr-dock-line2 240ms cubic-bezier(.22,1,.36,1) 420ms both}',
      '@keyframes dfr-dock-line2{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
      '.dfr-dock-label{flex:none;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.01em}',
      '.dfr-dock-query{min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dfr-dock-count{margin-left:auto;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dfr-dock-hit{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dfr-dock-loc{flex:none;font-size:12px;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums}',
      '.dfr-dock-empty{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dfr-dock-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin:-6px -4px -6px 2px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background 140ms ease,color 140ms ease}',
      '.dfr-dock-close:hover{background:color-mix(in oklab,var(--dsw-alias-label-primary) 9%,transparent);color:var(--dsw-alias-label-primary)}',
      '.dfr-dock-close:active{transform:scale(.94)}',
      '.dfr-dock-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '@media (prefers-reduced-motion: reduce){.dfr-btn{transition:none}.dfr-btn:active:not(:disabled){transform:none}.dfr-signal-sweep,.dfr-dock-scan{display:none}.dfr-term,.dfr-hit,.dfr-hit-bloom,.dfr-dot-pulse{animation:none}.dfr-hit-bloom{opacity:1}.dfr-dock,.dfr-dock-line-2,.dfr-dock-closing{animation:none;opacity:1;transform:none}.dfr-dock-close{transition:none}}',
    ].join('\n')

    function ensureStyle() {
      if (typeof document === 'undefined') return function () {}
      const existing = document.getElementById(STYLE_ID)
      if (existing && existing.getAttribute('data-owner') === ID) {
        // A reload can register the client again in the same page session. Keeping
        // the old element would leave the panel on stale CSS, so refresh it when
        // the text differs.
        if (existing.textContent !== CSS) existing.textContent = CSS
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

    /**
     * Claim this plugin's own Tool view in the conversation: the recall card is
     * drawn where the search actually happens, in the chat, not behind a sidebar.
     * The key is the wire tool name; an unclaimed key would fall back to the
     * generic tool row, so a failed registration degrades to that.
     */
    function mountToolView(ctx) {
      try {
        ctx.effect(function () {
          try {
            return ctx.slots.inject('tool.call.toolview', function () {
              try {
                return ctx.slots.register(
                  {
                    name: 'tool.call.toolview',
                    key: 'file_recall_search',
                    locale: NS,
                    inject: function injectToolView() {
                      return {}
                    },
                  },
                  function RecallToolViewEntry(props) {
                    return h(RecallToolBoundary, null, h(RecallToolView, props))
                  },
                )
              } catch (failure) {
                warn('chat tool view registration refused', failure)
                return function () {}
              }
            })
          } catch (failure) {
            warn('chat tool view inject failed', failure)
            return function () {}
          }
        }, 'file-recall: chat tool view')
      } catch (failure) {
        warn('chat tool view mount failed', failure)
      }
    }

    /**
     * Claim the always-visible conversation strip above the composer.
     *
     * This is the seat that cannot be missed: it is in the chat, it is full
     * width, and it needs no expanded tool row. The tool-row view below stays as
     * the detailed, per-call record.
     */
    function mountChatDock(ctx) {
      try {
        ctx.effect(function () {
          try {
            return ctx.slots.inject('conversation.input.dock', function () {
              try {
                return ctx.slots.register(
                  {
                    name: 'conversation.input.dock',
                    id: 'file-recall',
                    order: 0,
                    locale: NS,
                    label: function dockLabel() {
                      return getT()('tv.title')
                    },
                    inject: function injectDock() {
                      return {}
                    },
                  },
                  function ChatDockEntry(props) {
                    return h(RecallToolBoundary, null, h(ChatDock, props))
                  },
                )
              } catch (failure) {
                warn('chat dock registration refused', failure)
                return function () {}
              }
            })
          } catch (failure) {
            warn('chat dock inject failed', failure)
            return function () {}
          }
        }, 'file-recall: chat dock')
      } catch (failure) {
        warn('chat dock mount failed', failure)
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

      mountToolView(ctx)
      mountChatDock(ctx)

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
