/**
 * Fishbone (Ishikawa) renderer for a proposed folder structure.
 *
 * The user asked to see the ideal structure as a fishbone before anything is
 * moved, so this module is a pure string builder: it takes a tree and returns a
 * standalone SVG. No dependencies, no browser assumptions, deterministic output
 * so the same proposal always renders identically.
 *
 * Layout: spine runs right to left toward the head (the outcome). Branches
 * alternate above and below the spine, children hang off each branch as small
 * ticks, deeper levels collapse into counts because a diagram that needs zooming
 * is not a summary.
 */

const INK = '#1b1b1b'
const MUTED = '#6b6b6b'
const RULE = '#c9c9c9'
const PAPER = '#ffffff'

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function clip(value, max) {
  const text = String(value ?? '')
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/**
 * @param {{
 *   head: string,
 *   subtitle?: string,
 *   branches: Array<{ label: string, count?: number, note?: string,
 *                     children?: Array<{ label: string, count?: number }> }>,
 *   width?: number,
 * }} input
 * @returns {string} standalone SVG document
 */
export function renderFishbone(input) {
  const head = String(input?.head ?? '目标')
  const subtitle = input?.subtitle ? String(input.subtitle) : ''
  const rules = Array.isArray(input?.rules) ? input.rules.filter(Boolean).map(String) : []
  const branches = Array.isArray(input?.branches) ? input.branches : []
  const width = Number(input?.width) > 0 ? Math.floor(input.width) : 1400

  const headW = 190
  const headH = 92
  const leftPad = 44
  const rightPad = 44
  const spineRight = width - rightPad - headW

  const rowH = 22
  const branchGap = 26
  const rowsOf = (branch) =>
    Math.max(
      1,
      Math.min(
        Number(input?.maxChildren) > 0 ? Number(input.maxChildren) : 3,
        Array.isArray(branch.children) ? branch.children.length : 0,
      ),
    )
  const above = []
  const below = []
  let side = true
  branches.forEach((branch, index) => {
    ;(side ? above : below).push({ branch, index, rows: rowsOf(branch) })
    side = !side
  })
  const reachOf = (entry) => entry.rows * rowH + branchGap
  // Bones do not stack: each one reaches out from the spine on its own. Sizing
  // the canvas from the SUM (as the first version did) left a dead band the
  // height of all branches above the first one.
  const maxAbove = above.reduce((max, entry) => Math.max(max, reachOf(entry)), 0)
  const maxBelow = below.reduce((max, entry) => Math.max(max, reachOf(entry)), 0)

  const headerH = rules.length > 0 ? 74 + rules.length * 19 + 16 : 86
  const midY = headerH + maxAbove + 46
  const height = Math.max(430, midY + maxBelow + 56)

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
  )
  parts.push(`<rect width="${width}" height="${height}" fill="${PAPER}"/>`)
  parts.push(
    `<text x="${leftPad}" y="40" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="20" font-weight="600" fill="${INK}">整理后的理想结构</text>`,
  )
  if (subtitle) {
    parts.push(
      `<text x="${leftPad}" y="64" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="13" fill="${MUTED}">${escapeXml(clip(subtitle, 110))}</text>`,
    )
  }

  // Rules live in the space the fishbone leaves empty at the top, so one page
  // carries both the picture and the reasoning a person approves.
  if (rules.length > 0) {
    parts.push(
      `<text x="${leftPad}" y="${74 + 8}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="12" font-weight="600" fill="${INK}">规则</text>`,
    )
    rules.forEach((rule, index) => {
      const y = 74 + 26 + index * 19
      parts.push(
        `<text x="${leftPad}" y="${y}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="12" fill="${MUTED}">${escapeXml(clip(rule, 78))}</text>`,
      )
    })
  }

  // Spine
  parts.push(
    `<line x1="${leftPad + 20}" y1="${midY}" x2="${spineRight}" y2="${midY}" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
  )
  // Tail: a fish needs one, and it marks where "input" enters.
  parts.push(
    `<path d="M${leftPad + 20} ${midY} l-18 -14 M${leftPad + 20} ${midY} l-18 14" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  )

  // Head: the outcome, at the right end.
  parts.push(
    `<rect x="${spineRight}" y="${midY - headH / 2}" width="${headW}" height="${headH}" rx="10" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>`,
  )
  parts.push(
    `<text x="${spineRight + headW / 2}" y="${midY - 6}" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="15" font-weight="600" fill="${INK}">${escapeXml(clip(head, 16))}</text>`,
  )
  parts.push(
    `<text x="${spineRight + headW / 2}" y="${midY + 16}" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11" fill="${MUTED}">一条路径就能找到</text>`,
  )

  const count = Math.max(1, branches.length)
  const slot = (spineRight - (leftPad + 60)) / count
  const branchX = branches.map((_branch, index) => leftPad + 60 + slot * (index + 0.5))

  function drawBranch(entry, direction) {
    const { branch, index, rows } = entry
    const x = branchX[index]
    const tipY = midY + direction * reachOf(entry)
    parts.push(
      `<line x1="${x}" y1="${midY}" x2="${x}" y2="${tipY}" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`,
    )
    const labelY = tipY + direction * 18
    parts.push(
      `<text x="${x}" y="${labelY}" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="13" font-weight="600" fill="${INK}">${escapeXml(clip(branch.label, 18))}</text>`,
    )
    const meta = []
    if (branch.count != null) meta.push(String(branch.count) + ' 个文件')
    if (meta.length > 0) {
      parts.push(
        `<text x="${x}" y="${labelY + direction * 15}" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11" fill="${MUTED}">${escapeXml(meta.join(' · '))}</text>`,
      )
    }

    // Keep child text away from the head, and keep neighbouring branches from
    // writing into each other: anything past the halfway point labels inward.
    const toLeft = x > spineRight - 320
    const children = Array.isArray(branch.children)
      ? branch.children.slice(0, Number(input?.maxChildren) > 0 ? Number(input.maxChildren) : 3)
      : []
    children.forEach((child, childIndex) => {
      const y = midY + direction * (branchGap + (childIndex + 0.5) * rowH)
      parts.push(
        `<line x1="${x}" y1="${y}" x2="${x + (toLeft ? -14 : 14)}" y2="${y}" stroke="${RULE}" stroke-width="1.2"/>`,
      )
      const text = `${clip(child.label, 26)}${child.count != null ? ' · ' + child.count : ''}`
      parts.push(
        toLeft
          ? `<text x="${x - 20}" y="${y + 4}" text-anchor="end" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11.5" fill="${MUTED}">${escapeXml(text)}</text>`
          : `<text x="${x + 20}" y="${y + 4}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11.5" fill="${MUTED}">${escapeXml(text)}</text>`,
      )
    })
  }

  above.forEach((entry) => drawBranch(entry, -1))
  below.forEach((entry) => drawBranch(entry, 1))

  parts.push('</svg>')
  return parts.join('\n')
}
