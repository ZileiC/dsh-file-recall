import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Guards for the graph rendering in the hand-written client bundle.
 *
 * The client cannot be imported here (it needs React and the ModuleLoader shell),
 * so these assert the shape of the drawing code itself. They exist because both
 * bugs shipped once and were only caught by the user looking at the screen:
 *
 * 1. control points interpolated along the chord — a cubic Bézier whose control
 *    points are colinear with its endpoints is the straight segment, so "curved
 *    wires" rendered as spokes;
 * 2. memory dots placed at a fixed radius from their node, which is exactly the
 *    lane of the next ring, so dots sat on top of nodes.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

test('graph wires are arcs, not chords', () => {
  // The control point must be offset along the chord normal...
  assert.match(source, /normalX/, 'expected a normal-vector computation for the wire bend')
  assert.match(source, /normalY/, 'expected a normal-vector computation for the wire bend')
  assert.match(source, /Q\$\{controlX\} \$\{controlY\}/, 'wires must be quadratic arcs')
  // ...and must NOT be a linear interpolation of the chord, which degenerates.
  assert.doesNotMatch(
    source,
    /\(entry\.x - fromX\) \* \(1 - knot\)/,
    'colinear control points make a Bézier identical to a straight line',
  )
  assert.doesNotMatch(source, /fromX \+ \(entry\.x - fromX\) \* knot/)
})

test('graph wires carry a real bend, computed off the chord midpoint', () => {
  const start = source.indexOf('const spanX = entry.x - fromX')
  const end = source.indexOf('fill:', start)
  const block = source.slice(start, end)
  assert.ok(block.length > 0, 'curve math block not found')
  // Offset is derived from the normalised normal, so it is perpendicular.
  assert.match(block, /const normalX = -spanY \/ distance/)
  assert.match(block, /const normalY = spanX \/ distance/)
  // Bend scales with length but is capped so short wires do not loop.
  assert.match(block, /Math\.min\(38, distance \* 0\.34\)/)
})

test('memory dots are placed by collision test, never by a fixed radius', () => {
  // A placement loop that rejects positions overlapping nodes...
  assert.match(source, /clearOfNodes/, 'expected a node-clearance test')
  assert.match(source, /clearOfDots/, 'expected a dot-clearance test')
  // ...and the node test uses the node radius plus the dot radius plus a gap
  // wide enough to read as "not touching" (the user rejected 3px twice).
  const clearance = source.match(/Math\.hypot\(dx, dy\) < entry\.radius \+ MEMORY_R \+ (\d+)/)
  assert.ok(clearance, 'clearance must account for both radii plus a visible gap')
  assert.ok(
    Number(clearance[1]) >= 6,
    `node gap too small to read as separate: ${clearance[1]}px`,
  )
  // Sibling dots must also keep their distance from each other.
  const dotGap = source.match(/Math\.hypot\(x - dot\.x, y - dot\.y\) < MEMORY_R \* 2 \+ (\d+)/)
  assert.ok(dotGap && Number(dotGap[1]) >= 5, 'dots may not touch each other')
  // Dots must also stay inside the drawing.
  assert.match(source, /x > box\.width - 10/)
})

test('memory dots avoid node labels, not just node circles', () => {
  // Node names are drawn at `radius + 10`; a dot placed at `radius + 14` lands
  // right on top of the text. Labels must therefore be obstacles too.
  assert.match(source, /labelBoxes/, 'expected a label-box computation')
  assert.match(source, /clearOfLabels/, 'expected a label-clearance test')
  assert.match(source, /clearOfLabels\(x, y\)/, 'the label test must gate placement')
  // The box must be derived from the drawn label position, not guessed.
  assert.match(source, /const top = entry\.y \+ entry\.radius \+ 2/)
  // CJK glyphs are wider than latin: the width estimate must know that.
  assert.match(source, /\\u3000-\\u9fff/)
})

test('the graph draws the real root folders, not a synthetic hub', () => {
  // The panel used to render a single invented centre labelled "everything",
  // which hid the real roots and merged two unrelated archives into one.
  assert.doesNotMatch(source, /dfr-groot/, 'the synthetic hub must be gone')
  assert.doesNotMatch(
    source,
    /: t\('graph\.root'\)/,
    'the graph header must show real root names, not the generic label',
  )
  // Roots are drawn like any other node, from the payload.
  assert.match(source, /node\.type === 'root'/)
  // Links are resolved by id (a relative path can exist under two roots)...
  assert.match(source, /entry\.node\.parentId \? byId\.get\(entry\.node\.parentId\)/)
  // ...and fall back to that archive's own root when the parent was capped away.
  assert.match(source, /'root:' \+ entry\.node\.root/)
})

test('the canvas is tall enough to separate rings', () => {
  const height = Number((source.match(/const GRAPH_H = (\d+)/) || [])[1])
  assert.ok(height >= 560, `graph canvas too short (${height}px): rings and dots collide`)
  const fractions = JSON.parse((source.match(/const GRAPH_RING_FRACTIONS = (\[[^\]]+\])/) || [])[1])
  assert.ok(fractions[1] - fractions[0] >= 0.25, 'ring 1 and ring 2 are too close together')
  assert.strictEqual(fractions[2], 1)
  // The CSS clamp must not be tighter than the drawing height, or the browser
  // squeezes the whole graph back into the crowded layout.
  const cssClamp = Number((source.match(/\.dfr-graph\{[^}]*max-height:(\d+)px/) || [])[1])
  assert.ok(cssClamp >= height, `CSS clamps the canvas to ${cssClamp}px below its ${height}px`)
})

test('memory dots are drawn after the nodes so they are never painted over', () => {
  const nodeIndex = source.indexOf('className: isFolder ? \'dfr-gfolder\' : \'dfr-gfile\'')
  const dotIndex = source.indexOf('className: \'dfr-gmemory dfr-gmemory-\' + dot.tone')
  assert.ok(nodeIndex > 0 && dotIndex > 0, 'expected both drawing passes')
  assert.ok(dotIndex > nodeIndex, 'dots must be painted after nodes')
})
