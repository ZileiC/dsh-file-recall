/**
 * Minimal PNG encoder (zlib + CRC32) for rasterized PDF pages.
 * Avoids shipping a native canvas dependency just to hand tesseract/Vision an
 * image buffer.
 */

import { deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let k = 0; k < 8; k += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[n] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function expandGrayscaleToRgb(data, width, height) {
  const out = Buffer.alloc(width * height * 3)
  for (let index = 0; index < width * height; index += 1) {
    const value = data[index] ?? 0
    out[index * 3] = value
    out[index * 3 + 1] = value
    out[index * 3 + 2] = value
  }
  return out
}

function expandOneBitToRgb(data, width, height) {
  const out = Buffer.alloc(width * height * 3)
  const rowBytes = Math.ceil(width / 8)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const byte = data[y * rowBytes + (x >> 3)] ?? 0
      const bit = (byte >> (7 - (x & 7))) & 1
      const value = bit ? 255 : 0
      const offset = (y * width + x) * 3
      out[offset] = value
      out[offset + 1] = value
      out[offset + 2] = value
    }
  }
  return out
}

/**
 * @param {{width:number,height:number,data:ArrayLike<number>,kind?:number}} image
 * @returns {Buffer} PNG bytes
 */
export function encodePng(image) {
  const { width, height, data } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('encodePng: invalid dimensions')
  }
  if (!data || typeof data.length !== 'number') throw new Error('encodePng: missing pixel data')

  const length = data.length
  const kind = image.kind
  let colorType = 2
  let channels = 3
  let pixels

  if (kind === 3 || length === width * height * 4) {
    colorType = 6
    channels = 4
    pixels = data
  } else if (kind === 2 || length === width * height * 3) {
    pixels = data
  } else if (kind === 1 || length === Math.ceil(width / 8) * height) {
    colorType = 2
    channels = 3
    pixels = expandOneBitToRgb(data, width, height)
  } else if (length === width * height) {
    colorType = 2
    channels = 3
    pixels = expandGrayscaleToRgb(data, width, height)
  } else {
    throw new Error(
      `encodePng: unsupported pixel layout (${length} bytes for ${width}x${height})`,
    )
  }

  const rowLength = width * channels
  const raw = Buffer.alloc((rowLength + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowLength + 1)
    raw[rowStart] = 0 // filter type: none
    const sourceStart = y * rowLength
    for (let x = 0; x < rowLength; x += 1) {
      raw[rowStart + 1 + x] = pixels[sourceStart + x] ?? 0
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
