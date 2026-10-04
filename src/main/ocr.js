import { app, desktopCapturer, screen } from 'electron'
import { join } from 'path'
import { createWorker } from 'tesseract.js'

let workerPromise

function getWorker() {
  // Language data is downloaded once and cached in userData
  workerPromise ??= createWorker('kor+eng', 1, { cachePath: join(app.getPath('userData'), 'tessdata') })
  return workerPromise
}

export async function readScreenText(maxChars = 600) {
  const { size, scaleFactor } = screen.getPrimaryDisplay()
  const [source] = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: size.width * scaleFactor, height: size.height * scaleFactor }
  })
  if (!source) return ''
  const worker = await getWorker()
  const { data } = await worker.recognize(source.thumbnail.toPNG())
  return data.text.replace(/\s+/g, ' ').trim().slice(0, maxChars)
}
