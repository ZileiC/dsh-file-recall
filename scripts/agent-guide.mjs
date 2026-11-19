#!/usr/bin/env node
/**
 * Renders docs/INSTALL-FOR-AGENTS.md into docs/INSTALL-FOR-AGENTS.html so the
 * Markdown an agent reads and the page a person opens can never drift apart.
 *
 * The Markdown stays the single source. This script covers exactly the subset of
 * Markdown that file uses (headings, fenced code, tables, lists, inline code,
 * bold, links, blockquotes, rules) and nothing else: anything it does not
 * recognise is rendered as plain text rather than silently dropped.
 *
 * Also used by .github/workflows/pages.yml, so the deployed site is generated the
 * same way as a local build.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
export const SOURCE = join(repo, 'docs', 'INSTALL-FOR-AGENTS.md')
export const OUTPUT = join(repo, 'docs', 'INSTALL-FOR-AGENTS.html')

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Inline: `code`, **bold**, [text](link). Code first so its contents stay literal. */
export function renderInline(text) {
  const slots = []
  let s = text.replace(/`([^`]+)`/g, (_, code) => {
    slots.push(`<code>${escapeHtml(code)}</code>`)
    return `\u0000${slots.length - 1}\u0000`
  })
  s = escapeHtml(s)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const external = /^https?:/i.test(href)
    const attrs = external ? ' target="_blank" rel="noopener"' : ''
    return `<a href="${href}"${attrs}>${label}</a>`
  })
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)])
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

/** Parse the Markdown subset into blocks. */
export function parse(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i += 1; continue }

    // Fenced code
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      const body = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1 }
      i += 1
      blocks.push({ type: 'code', lang: fence[1] || '', text: body.join('\n') })
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push({ type: 'hr' }); i += 1; continue }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      i += 1
      continue
    }

    // Table: a header row followed by a separator row
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const cells = (row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(cells(lines[i])); i += 1 }
      blocks.push({ type: 'table', head, rows })
      continue
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const body = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { body.push(lines[i].replace(/^>\s?/, '')); i += 1 }
      blocks.push({ type: 'quote', text: body.join('\n') })
      continue
    }

    // Task list / bullet list / ordered list
    if (/^\s*(-|\*|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items = []
      while (i < lines.length && /^\s*(-|\*|\d+\.)\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*(-|\*|\d+\.)\s+(.*)$/)
        let text = m[2]
        let checked = null
        const task = text.match(/^\[( |x|X)\]\s+(.*)$/)
        if (task) { checked = task[1].toLowerCase() === 'x'; text = task[2] }
        items.push({ text, checked })
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // Paragraph: consume until a blank line or the start of another block
    const body = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|>|-\s|\*\s|\d+\.\s|\|)/.test(lines[i]) &&
      !/^(-{3,}|\*{3,})\s*$/.test(lines[i])
    ) { body.push(lines[i].trim()); i += 1 }
    if (body.length) blocks.push({ type: 'paragraph', text: body.join(' ') })
  }

  return blocks
}

const renderList = (block) =>
  block.items
    .map((item) => {
      if (item.checked === null) return `<li>${renderInline(item.text)}</li>`
      const mark = item.checked ? '✓' : ''
      const cls = item.checked ? ' class="done"' : ''
      return `<li${cls}><span class="box" aria-hidden="true">${mark}</span>${renderInline(item.text)}</li>`
    })
    .join('\n')

const renderTable = (block) => {
  const head = block.head.map((c) => `<th>${renderInline(c)}</th>`).join('')
  const rows = block.rows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
    .join('\n')
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>\n${rows}\n</tbody></table></div>`
}

/** Render blocks to the body HTML of a guide page. */
export function renderBody(blocks) {
  const out = []
  let listOpen = false

  for (const b of blocks) {
    if (b.type !== 'list' && listOpen) { out.push('</ul>'); listOpen = false }
    if (b.type === 'heading') {
      const id = slug(b.text)
      out.push(`<h${b.level} id="${id}">${renderInline(b.text)}</h${b.level}>`)
    } else if (b.type === 'paragraph') {
      out.push(`<p>${renderInline(b.text)}</p>`)
    } else if (b.type === 'code') {
      out.push(`<pre class="code" tabindex="0"><code>${escapeHtml(b.text)}</code></pre>`)
    } else if (b.type === 'table') {
      out.push(renderTable(b))
    } else if (b.type === 'quote') {
      out.push(`<div class="note"><p>${renderInline(b.text).replace(/\n/g, '<br>')}</p></div>`)
    } else if (b.type === 'hr') {
      out.push('<hr>')
    } else if (b.type === 'list') {
      // Task lists become a checklist; ordinary lists stay a list.
      const isTask = b.items.some((it) => it.checked !== null)
      out.push(isTask ? `<ul class="checklist">\n${renderList(b)}\n</ul>` : `<ul>\n${renderList(b)}\n</ul>`)
      listOpen = false
    }
  }
  if (listOpen) out.push('</ul>')
  return out.join('\n')
}

/** Pull the page title and the lead paragraph from the Markdown. */
function readMeta(blocks) {
  const title = blocks.find((b) => b.type === 'heading' && b.level === 1)
  const lead = blocks.find((b) => b.type === 'paragraph')
  return {
    title: title ? title.text : '安装与接入说明',
    lead: lead ? lead.text : ''
  }
}

/**
 * Build the full page. `inline` inlines docs/guide.css and docs/guide.js so the
 * result works as a single file, exactly like the standalone install guide.
 */
export function buildPage(md, { inline = false } = {}) {
  const blocks = parse(md)
  const meta = readMeta(blocks)
  const body = renderBody(blocks)

  const css = inline
    ? `<style>\n${readFileSync(join(repo, 'docs', 'guide.css'), 'utf8')}\n${AGENT_CSS}\n</style>`
    : '<link rel="stylesheet" href="guide.css">\n<style>\n' + AGENT_CSS + '\n</style>'
  const js = inline
    ? `<script>\n${readFileSync(join(repo, 'docs', 'guide.js'), 'utf8')}\n</script>`
    : '<script src="guide.js"></script>'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)} · dsh-file-recall</title>
${css}
</head>
<body>

<header class="hero">
  <div class="hero-inner solo">
    <div>
      <p class="kicker">给 agent 的安装与接入说明 · 命令行路径</p>
      <h1>${escapeHtml(meta.title)}</h1>
      <p class="lede">${escapeHtml(meta.lead)}</p>
      <p class="back"><a href="/">全部文档</a></p>
    </div>
  </div>
</header>

<div class="shell solo">
  <main class="doc">
${body}
  </main>
</div>

${js}
</body>
</html>
`
}

/** The few extra rules the generated page needs on top of the shared sheet. */
const AGENT_CSS = `  /* ---- generated from docs/INSTALL-FOR-AGENTS.md ---- */
  .doc h2 {
    font-size: 1.28rem; line-height: 1.4; margin: 2.8rem 0 .7rem; font-weight: 600;
    letter-spacing: -.006em; padding-top: 2.2rem; border-top: 1px solid var(--rule);
  }
  .doc h2:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
  .doc h3 { font-size: 1.08rem; margin: 1.9rem 0 .6rem; font-weight: 600; }
  .doc p { margin: 0 0 1rem; color: var(--ink-2); }
  .doc p strong { color: var(--ink); }
  .doc ul { margin: .4rem 0 1.2rem; padding-left: 1.2rem; color: var(--ink-2); }
  .doc ul li { margin: .3rem 0; }
  .doc hr { border: 0; border-top: 1px solid var(--rule); margin: 2.4rem 0; }
  .doc code {
    font-family: var(--mono); font-size: .9em; background: var(--rule-2);
    padding: .08em .32em; border-radius: 4px; color: var(--ink);
  }
  pre.code {
    font-family: var(--mono); font-size: 14px; line-height: 1.65; color: var(--ink);
    background: var(--surface); border: 1px solid var(--rule); border-radius: 10px;
    padding: 1rem 1.1rem; margin: .9rem 0 1.3rem; overflow-x: auto;
    white-space: pre; tab-size: 2;
  }
  pre.code code { background: none; padding: 0; font-size: inherit; }
  .checklist .box {
    position: absolute; left: 0; top: .74rem; width: 13px; height: 13px;
    border: 1.5px solid var(--rule); border-radius: 3px; background: var(--surface);
    display: grid; place-items: center; font-size: 10px; line-height: 1;
    color: var(--accent); font-family: var(--mono);
  }
`

function main() {
  const md = readFileSync(SOURCE, 'utf8')
  const page = buildPage(md, { inline: false })
  writeFileSync(OUTPUT, page, 'utf8')
  console.log(`rendered ${OUTPUT} (${Buffer.byteLength(page, 'utf8')} bytes)`)
}

if (process.argv[1] && process.argv[1].endsWith('agent-guide.mjs')) main()
