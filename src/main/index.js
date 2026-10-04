import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { randomUUID } from 'crypto'
import { readFile, rm } from 'fs/promises'
import { join } from 'path'
import { EdgeTTS } from 'node-edge-tts'
import { chat } from './ai'
import { watchActiveWindow, readActiveWindow } from './watcher'
import { readScreenText } from './ocr'
import { getSettings, setToolToggles } from './settings'
import { warmUpAppCatalog } from './tools'

const WIDTH = 360
const HEIGHT = 620

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: workArea.x + workArea.width - WIDTH,
    y: workArea.y + workArea.height - 440,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  const stop = watchActiveWindow((w) => win.webContents.send('active-window', w))
  // Send the global cursor position (window-relative) so the UI can react even outside the window
  const cursorTimer = setInterval(() => {
    if (win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const work = screen.getDisplayMatching(b).workArea
    win.webContents.send('cursor', { x: p.x - b.x, y: p.y - b.y, bounds: b, work })
  }, 100)
  win.on('closed', () => {
    stop()
    clearInterval(cursorTimer)
  })
}

ipcMain.on('set-ignore-mouse', (e, ignore) => {
  BrowserWindow.fromWebContents(e.sender)?.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.on('quit', () => app.quit())

ipcMain.handle('active-window:get', () => readActiveWindow())
ipcMain.handle('screen-text:get', () => readScreenText(1500))
ipcMain.handle('tts:synthesize', async (_e, text) => {
  const file = join(app.getPath('temp'), `desktop-pet-${randomUUID()}.mp3`)
  try {
    const tts = new EdgeTTS({
      voice: 'en-US-AriaNeural',
      lang: 'en-US',
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
      rate: '+0%',
      pitch: '+0Hz'
    })
    await tts.ttsPromise(String(text).slice(0, 1500), file)
    return (await readFile(file)).toString('base64')
  } finally {
    await rm(file, { force: true }).catch(() => {})
  }
})

// Dragging follows the global cursor so the window cannot lose the mouse when it moves under it
let dragTimer
function stopDrag() {
  clearInterval(dragTimer)
  dragTimer = null
}
ipcMain.on('drag-start', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  const c = screen.getCursorScreenPoint()
  const [x, y] = win.getPosition()
  const offX = c.x - x
  const offY = c.y - y
  stopDrag()
  dragTimer = setInterval(() => {
    if (win.isDestroyed()) return stopDrag()
    const p = screen.getCursorScreenPoint()
    // Fixed size on every move avoids window growth on scaled displays
    win.setBounds({ x: p.x - offX, y: p.y - offY, width: WIDTH, height: HEIGHT })
  }, 16)
})
ipcMain.on('drag-end', stopDrag)

ipcMain.handle('settings:get', () => getSettings().tools)
ipcMain.handle('settings:set', (_e, tools) => setToolToggles(tools).tools)

const chatControllers = new Map()
ipcMain.on('chat:cancel', (_e, id) => chatControllers.get(id)?.abort())

const pendingConfirms = new Map()
ipcMain.on('confirm-response', (_e, id, ok) => {
  pendingConfirms.get(id)?.(ok === true)
  pendingConfirms.delete(id)
})

let confirmSeq = 0
function askConfirm(sender, message) {
  return new Promise((resolve) => {
    const id = ++confirmSeq
    pendingConfirms.set(id, resolve)
    sender.send('confirm-request', { id, message })
    setTimeout(() => {
      if (pendingConfirms.delete(id)) resolve(false)
    }, 30000)
  })
}

ipcMain.handle('chat', async (e, { text, kind, id }) => {
  const controller = new AbortController()
  chatControllers.set(id, controller)
  const send = (channel, payload) => {
    if (!e.sender.isDestroyed()) e.sender.send(channel, { id, payload })
  }
  try {
    await chat(String(text).slice(0, 4000), kind, {
      signal: controller.signal,
      onChunk: (chunk) => send('chat-chunk', chunk),
      onTool: (label) => send('chat-tool', label),
      onReset: () => send('chat-reset'),
      confirm: (message) => askConfirm(e.sender, message)
    })
    if (controller.signal.aborted) return send('chat-cancelled')
    send('chat-done')
  } catch (err) {
    send(controller.signal.aborted ? 'chat-cancelled' : 'chat-error', err.message)
  } finally {
    chatControllers.delete(id)
  }
})

app.whenReady().then(() => {
  createWindow()
  warmUpAppCatalog()
})
app.on('window-all-closed', () => app.quit())
