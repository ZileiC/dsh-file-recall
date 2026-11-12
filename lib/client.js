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
    const EXPECTED_API_VERSION = 2
    const API_ROOT = '/api/file-recall'
    const STYLE_ID = 'dsh-file-recall/client.css'
    const POLL_MS = 4000

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

    function statusTone(data) {
      if (!data) return 'idle'
      if ((data.errors || 0) > 0) return 'error'
      if ((data.pending || 0) > 0) return 'pending'
      if ((data.files || 0) > 0) return 'ready'
      return 'idle'
    }

    /* ------------------------------------------------------------ components */

    function Dot(props) {
      return h('span', { className: 'dfr-dot dfr-dot-' + props.tone, 'aria-hidden': 'true' })
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
      const data = state.data
      const tone = statusTone(data)
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
              h(Dot, { tone: tone }),
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
        state.phase !== 'loading' ? h(PanelBody, { data: data, recent: recent }) : null,
      )
    }

    function PanelIcon(props) {
      const active = !props || props.active !== false
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
      '@media (prefers-reduced-motion: reduce){.dfr-btn{transition:none}.dfr-btn:active:not(:disabled){transform:none}}',
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
