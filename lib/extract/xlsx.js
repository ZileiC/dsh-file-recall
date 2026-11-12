/**
 * xlsx text extraction through exceljs.
 * Formula cells contribute their cached result only; formulas themselves are
 * not text and are never evaluated by this plugin.
 */

import ExcelJS from 'exceljs'

import { normalizeText } from './util.js'

const ROWS_PER_BLOCK = 50

function cellText(cell) {
  const value = cell?.value
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((run) => run.text ?? '').join('')
    if (value.text != null) return String(value.text)
    if (value.result != null) return String(value.result)
    if (value.error) return ''
    if (value.formula) return ''
    return ''
  }
  return String(value)
}

export async function extractXlsx(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const chunks = []
  let sheetIndex = 0

  workbook.eachSheet((sheet) => {
    sheetIndex += 1
    const rows = []
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells = []
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = cellText(cell)
        if (text) cells.push(text)
      })
      if (cells.length > 0) rows.push({ rowNumber, text: cells.join(' ｜ ') })
    })

    for (let index = 0; index < rows.length; index += ROWS_PER_BLOCK) {
      const block = rows.slice(index, index + ROWS_PER_BLOCK)
      const first = block[0].rowNumber
      const last = block[block.length - 1].rowNumber
      const text = normalizeText(
        `[${sheet.name} 第${first}-${last}行]\n${block.map((row) => row.text).join('\n')}`,
      )
      if (text) chunks.push({ kind: 'sheet', page: sheetIndex, block: first, text })
    }
  })

  return { status: 'ok', chunks }
}
