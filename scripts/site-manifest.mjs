/**
 * What is allowed to be published, listed one file at a time.
 *
 * This exists because copying `docs/` wholesale onto the web publishes whatever
 * happens to be in that folder, including documents written for internal use.
 * Anything not named here is NOT published, and `node scripts/check-site.mjs`
 * fails if a published page links to something outside the list.
 *
 * Adding a file here is a deliberate act: if it mentions a person, a client, a
 * machine name or an internal process, do not add it.
 */

/** Files copied from the repo root into the site root. */
export const ROOT_FILES = ['index.html', 'icon.svg']

/**
 * Files copied from docs/ into <site>/docs/.
 * These are reader-facing only: install pages and the agent install tutorial.
 */
export const DOCS_FILES = [
  'install-universal.html',
  'install-universal-standalone.html',
  'install-windows.html',
  'install-windows-standalone.html',
  'INSTALL-FOR-AGENTS.html',
  'guide.css',
  'guide.js',
  'img/README.md', // referenced by the guide as a note for whoever replaces the screenshots
  'img/hero-shot.png',
  'img/step-01-menu.png'
]

/** Paths (relative to the repo) that must never appear in the site. */
export const FORBIDDEN = [
  'ACCEPTANCE',
  'design-notes',
  'GUIDE-SPEC',
  'traffic',
  'private',
  'journal',
  'install.html', // the personal, single-reader version: never public
  'install-standalone.html'
]
