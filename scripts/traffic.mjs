#!/usr/bin/env node
/**
 * Snapshots GitHub's own traffic history into .github/stats/.
 *
 *   node scripts/traffic.mjs
 *
 * Why this exists: GitHub keeps views/clones for 14 days and then they are gone.
 * Release download counts are cumulative and survive, but traffic does not. This
 * appends one JSON line per day, keyed by date, so re-running is idempotent and a
 * cron job or a human remembering to run it both produce a clean series.
 *
 * Numbers that must not be read as "people who installed this":
 *   - clones include automated fetches; unauthenticated traffic is what is counted,
 *     and mirrors/crawlers/bots dominate a small public repo.
 *   - only release asset downloads are a direct count of package fetches.
 * The snapshot records what GitHub reported, verbatim, and no interpretation.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const outDir = join(repo, '.github', 'stats')
const REPO = 'ZileiC/dsh-file-recall'

function gh(path) {
  const raw = execFileSync('gh', ['api', path], { encoding: 'utf8' })
  return JSON.parse(raw)
}

function main() {
  const views = gh(`repos/${REPO}/traffic/views`)
  const clones = gh(`repos/${REPO}/traffic/clones`)
  const releases = gh(`repos/${REPO}/releases?per_page=100`)

  const downloads = []
  for (const release of releases) {
    for (const asset of release.assets || []) {
      downloads.push({
        release: release.tag_name,
        asset: asset.name,
        downloads: asset.download_count,
        publishedAt: asset.created_at,
        sizeBytes: asset.size
      })
    }
  }

  const totalDownloads = downloads.reduce((sum, d) => sum + d.downloads, 0)
  const today = new Date().toISOString().slice(0, 10)

  const snapshot = {
    date: today,
    repo: REPO,
    views: { count: views.count, uniques: views.uniques, days: views.views },
    clones: { count: clones.count, uniques: clones.uniques, days: clones.clones },
    releaseDownloads: downloads,
    totalReleaseDownloads: totalDownloads
  }

  mkdirSync(outDir, { recursive: true })

  // Idempotent: one line per day, replaced when the day is re-run.
  const jsonl = join(outDir, 'traffic.jsonl')
  const existing = existsSync(jsonl)
    ? readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)
    : []
  const kept = existing.filter((line) => {
    try { return JSON.parse(line).date !== today } catch { return false }
  })
  writeFileSync(jsonl, [...kept, JSON.stringify(snapshot)].join('\n') + '\n', 'utf8')

  // Human-readable series of the two headline numbers.
  const csv = join(outDir, 'traffic.csv')
  const header = 'date,views,viewers,clones,clone_ranges,release_downloads\n'
  const rows = [...kept, JSON.stringify(snapshot)]
    .map((line) => {
      const s = JSON.parse(line)
      return [s.date, s.views.count, s.views.uniques, s.clones.count, s.clones.uniques, s.totalReleaseDownloads].join(',')
    })
  writeFileSync(csv, header + rows.join('\n') + '\n', 'utf8')

  console.log(`snapshot ${today}`)
  console.log(`  views   ${views.count} (${views.uniques} viewers, last 14 days)`)
  console.log(`  clones  ${clones.count} (${clones.uniques} unauthenticated sources)`)
  console.log(`  release downloads ${totalDownloads}`)
  for (const d of downloads) console.log(`    ${d.asset} (${d.release}): ${d.downloads}`)
  console.log(`\nwrote ${jsonl}`)
  console.log(`wrote ${csv}`)
}

main()
