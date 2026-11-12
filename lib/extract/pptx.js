/**
 * pptx text extraction: one chunk per slide, plus one chunk per notes page.
 * Slide order follows `p:sldIdLst` (presentation order), not zip entry order.
 */

import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'

import { decodeXmlEntities, normalizeText } from './util.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
})

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

async function readZipText(zip, path) {
  const entry = zip.file(path)
  if (!entry) return null
  return entry.async('string')
}

/** Extract paragraph text from a DrawingML part (slide or notes slide). */
export function textFromDrawingXml(xml) {
  if (!xml) return ''
  // Slide-number and date fields are noise; drop the whole field element.
  const withoutFields = xml.replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, '')
  const paragraphs = withoutFields.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? []
  const lines = []
  for (const paragraph of paragraphs) {
    const runs = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) =>
      decodeXmlEntities(match[1]),
    )
    const line = runs.join('').replace(/\s+/g, ' ').trim()
    if (line) lines.push(line)
  }
  return normalizeText(lines.join('\n'))
}

function relationshipMap(relsXml) {
  const map = new Map()
  if (!relsXml) return map
  const parsed = xmlParser.parse(relsXml)
  const relationships = asArray(parsed?.Relationships?.Relationship)
  for (const relationship of relationships) {
    const id = relationship?.['@_Id']
    const target = relationship?.['@_Target']
    const type = relationship?.['@_Type'] ?? ''
    if (id && target) map.set(String(id), { target: String(target), type: String(type) })
  }
  return map
}

function normalizePartPath(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = `${baseDir}/${target}`.split('/')
  const stack = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

export async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer)

  const presentationXml = await readZipText(zip, 'ppt/presentation.xml')
  if (!presentationXml) throw new Error('pptx: missing ppt/presentation.xml')

  const parsed = xmlParser.parse(presentationXml)
  const slideIds = asArray(parsed?.['p:presentation']?.['p:sldIdLst']?.['p:sldId'])
  if (slideIds.length === 0) return { status: 'ok', chunks: [] }

  const presentationRels = relationshipMap(await readZipText(zip, 'ppt/_rels/presentation.xml.rels'))
  const chunks = []

  for (let index = 0; index < slideIds.length; index += 1) {
    const relId = String(slideIds[index]?.['@_r:id'] ?? '')
    const rel = presentationRels.get(relId)
    if (!rel) continue
    const slidePath = normalizePartPath('ppt', rel.target)
    const slideXml = await readZipText(zip, slidePath)
    const slideText = textFromDrawingXml(slideXml)
    const page = index + 1
    if (slideText) chunks.push({ kind: 'slide', page, text: slideText })

    // Notes live beside the slide: ppt/slides/_rels/slideN.xml.rels
    const slideDir = slidePath.slice(0, slidePath.lastIndexOf('/') + 1)
    const slideFile = slidePath.slice(slidePath.lastIndexOf('/') + 1)
    const notesRelsPath = `${slideDir}_rels/${slideFile}.rels`
    const notesRelsXml = await readZipText(zip, notesRelsPath)
    const notesRel = [...relationshipMap(notesRelsXml).values()].find((item) =>
      item.type.endsWith('/notesSlide'),
    )
    if (notesRel) {
      const notesPath = normalizePartPath(slideDir, notesRel.target)
      const notesText = textFromDrawingXml(await readZipText(zip, notesPath))
      if (notesText) chunks.push({ kind: 'notes', page, text: notesText })
    }
  }

  return { status: 'ok', chunks }
}
