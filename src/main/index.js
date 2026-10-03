import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { chat } from './ai'
import { watchActiveWindow } from './watcher'
import { getSettings, setToolToggles } from './settings'

const WIDTH = 360
const HEIGHT = 480

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: workArea.x + workArea.width - WIDTH,
    y: workArea.y + workArea.height - HEIGHT,
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
  win.on('closed', stop)
}

ipcMain.on('set-ignore-mouse', (e, ignore) => {
  BrowserWindow.fromWebContents(e.sender)?.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.on('quit', () => app.quit())

ipcMain.handle('settings:get', () => getSettings().tools)
ipcMain.handle('settings:set', (_e, tools) => setToolToggles(tools).tools)

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

ipcMain.handle('chat', async (e, { text, kind }) => {
  const send = (channel, payload) => {
    if (!e.sender.isDestroyed()) e.sender.send(channel, payload)
  }
  try {
    await chat(String(text).slice(0, 4000), kind, {
      onChunk: (chunk) => send('chat-chunk', chunk),
      onTool: (label) => send('chat-tool', label),
      onReset: () => send('chat-reset'),
      confirm: (message) => askConfirm(e.sender, message)
    })
    send('chat-done')
  } catch (err) {
    send('chat-error', err.message)
  }
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
