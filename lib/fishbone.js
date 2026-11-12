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
  const branches = Array.isArray(input?.branches) ? input.branches : []
  const width = Number(input?.width) > 0 ? Math.floor(input.width) : 1200

  const headW = 190
  const headH = 92
  const leftPad = 40
  const rightPad = 40
  const spineRight = width - rightPad - headW

  // Vertical space per branch is driven by how many children it carries.
  const rowsPerBranch = branches.map((branch) =>
    Math.max(1, Math.min(4, Array.isArray(branch.children) ? branch.children.length : 0)),
  )
  const rowH = 26
  const branchGap = 34
  const above = []
  const below = []
  let side = true
  branches.forEach((branch, index) => {
    ;(side ? above : below).push({ branch, index, rows: rowsPerBranch[index] })
    side = !side
  })
  const heightOf = (list) =>
    list.reduce((sum, entry) => sum + entry.rows * rowH + branchGap, 0)
  const aboveH = heightOf(above)
  const belowH = heightOf(below)
  const midY = 90 + aboveH
  const height = Math.max(360, midY + belowH + 70)

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
  )
  parts.push(`<rect width="${width}" height="${height}" fill="${PAPER}"/>`)
  parts.push(
    `<text x="${leftPad}" y="42" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="20" font-weight="600" fill="${INK}">整理后的理想结构</text>`,
  )
  if (subtitle) {
    parts.push(
      `<text x="${leftPad}" y="68" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="13" fill="${MUTED}">${escapeXml(clip(subtitle, 90))}</text>`,
    )
  }

  // Spine
  parts.push(
    `<line x1="${leftPad + 90}" y1="${midY}" x2="${spineRight}" y2="${midY}" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
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

  // Branch positions: evenly spread along the spine, leaving the head clear.
  const count = Math.max(1, branches.length)
  const slot = (spineRight - (leftPad + 110)) / count
  const branchX = branches.map((_branch, index) => leftPad + 110 + slot * (index + 0.5))

  function drawBranch(entry, direction) {
    const { branch, index, rows } = entry
    const x = branchX[index]
    const reach = rows * rowH + branchGap
    const tipY = midY + direction * reach
    parts.push(
      `<line x1="${x}" y1="${midY}" x2="${x}" y2="${tipY}" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`,
    )
    // Branch label sits outside its own tip, so the spine stays readable.
    const labelY = tipY + direction * 20
    parts.push(
      `<text x="${x}" y="${labelY}" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="13.5" font-weight="600" fill="${INK}">${escapeXml(clip(branch.label, 14))}</text>`,
    )
    const meta = []
    if (branch.count != null) meta.push(String(branch.count))
    if (branch.note) meta.push(String(branch.note))
    if (meta.length > 0) {
      parts.push(
        `<text x="${x}" y="${labelY + direction * 16}" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11" fill="${MUTED}">${escapeXml(clip(meta.join(' · '), 22))}</text>`,
      )
    }

    const children = Array.isArray(branch.children) ? branch.children.slice(0, 4) : []
    children.forEach((child, childIndex) => {
      const y = midY + direction * (branchGap + (childIndex + 0.6) * rowH)
      parts.push(
        `<line x1="${x}" y1="${y}" x2="${x + 16}" y2="${y}" stroke="${RULE}" stroke-width="1.2"/>`,
      )
      parts.push(
        `<text x="${x + 22}" y="${y + 4}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11.5" fill="${MUTED}">${escapeXml(clip(child.label, 16))}${child.count != null ? ' · ' + child.count : ''}</text>`,
      )
    })
  }

  above.forEach((entry) => drawBranch(entry, -1))
  below.forEach((entry) => drawBranch(entry, 1))

  parts.push('</svg>')
  return parts.join('\n')
}
