/**
 * JXA bridge to Apple's Vision OCR. Invoked as:
 *   osascript -l JavaScript vision-ocr.jxa.js <image-path>
 *
 * Returns a JSON string. This script is EXPERIMENTAL and has not been executed
 * on macOS yet; the provider probes availability and falls back to tesseract.
 */

ObjC.import('Vision')
ObjC.import('Foundation')

function run(argv) {
  if (!argv || argv.length === 0) {
    throw new Error('usage: osascript -l JavaScript vision-ocr.jxa.js <image-path>')
  }

  const imageUrl = $.NSURL.fileURLWithPath(argv[0])
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(imageUrl, $())
  const request = $.VNRecognizeTextRequest.alloc.init
  request.recognitionLevel = 0 // VNRequestTextRecognitionLevelAccurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ['zh-Hans', 'en-US']

  const performed = handler.performRequestsError($([request]), $())
  if (!performed) throw new Error('Vision OCR request failed')

  const results = request.results
  const lines = []
  let confidenceSum = 0
  let confidenceCount = 0
  for (let index = 0; index < results.count; index += 1) {
    const observation = results.objectAtIndex(index)
    const candidates = observation.topCandidates(1)
    if (candidates.count === 0) continue
    const candidate = candidates.objectAtIndex(0)
    lines.push(candidate.string.js)
    confidenceSum += Number(candidate.confidence)
    confidenceCount += 1
  }

  return JSON.stringify({
    text: lines.join('\n'),
    confidence: confidenceCount > 0 ? confidenceSum / confidenceCount : null,
  })
}
