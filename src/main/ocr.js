import { app, desktopCapturer, screen } from 'electron'
import { join } from 'path'
import { createWorker, PSM } from 'tesseract.js'

let workerPromise

function getWorker() {
  // Language data is downloaded once and cached in userData
  workerPromise ??= createWorker('kor+eng', 1, { cachePath: join(app.getPath('userData'), 'tessdata') })
    .then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300'
      })
      return worker
    })
  return workerPromise
}

export async function readScreenText(maxChars = 600) {
  const display = screen.getPrimaryDisplay()
  const { size, scaleFactor } = display
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: size.width * scaleFactor, height: size.height * scaleFactor }
  })
  const source = sources.find(({ display_id }) => display_id === String(display.id)) ?? sources[0]
  if (!source) return ''
  const worker = await getWorker()
  const { data } = await worker.recognize(source.thumbnail.toPNG())
  return data.text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxChars)
}
