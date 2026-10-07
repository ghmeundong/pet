import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, session } from 'electron'
import { randomUUID } from 'crypto'
import { readFile, rm } from 'fs/promises'
import { spawn, spawnSync } from 'child_process'
import { createServer } from 'http'
import { createRequire } from 'module'
import { createServer as createTcpServer } from 'net'
import { extname, join, resolve, sep } from 'path'
import { existsSync } from 'fs'
import { EdgeTTS } from 'node-edge-tts'
import { chat, configureAI } from './ai'
import { watchActiveWindow, readActiveWindow } from './watcher'
import { readScreenText } from './ocr'
import { getSettings, setAISettings, setToolToggles } from './settings'
import { warmUpAppCatalog } from './tools'
import { captureSelectedText, insertTextAtTarget } from './selection'

const WIDTH = 440
const HEIGHT = 800
const WAKE_SHORTCUT = 'Control+Shift+Space'
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:3b'
const require = createRequire(import.meta.url)
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const wakeModelFiles = new Set([
  'embedding_model.onnx',
  'hey_jarvis_v0.1.onnx',
  'melspectrogram.onnx',
  'silero_vad.onnx'
])
const wakeRuntimeFiles = new Map([
  ['ort-wasm-simd-threaded.jsep.wasm', 'application/wasm'],
  ['ort-wasm-simd-threaded.jsep.mjs', 'text/javascript; charset=utf-8']
])
const wakeWasmPaths = new Map([...wakeRuntimeFiles].map(([name]) => [
  name,
  require.resolve(`onnxruntime-web/${name}`)
]))

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
let mainWindow
let wakePending = null
let shortcutCapturePending = false
let wakeShortcutRegistered = false
let wakeAssetServer
let wakeAssetBaseUrl = ''
let ollamaProcess
let localModelStatus = {
  ready: !app.isPackaged,
  phase: app.isPackaged ? 'Preparing local language model' : '',
  error: ''
}

function findAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createTcpServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

function setLocalModelStatus(status) {
  localModelStatus = status
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('local-model:status', status)
}

function findInstalledOllama() {
  const candidates = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Ollama', 'ollama.exe')
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  const result = spawnSync('where.exe', ['ollama.exe'], { encoding: 'utf8', windowsHide: true })
  return result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean) : undefined
}

function runHiddenProcess(executable, args, { env = process.env, cwd, onOutput, timeoutMs = 45 * 60 * 1000 } = {}) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let timeout
    const append = (chunk) => {
      output = (output + chunk.toString()).slice(-12000)
      onOutput?.(chunk.toString())
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => {
      clearTimeout(timeout)
      rejectProcess(error)
    })
    timeout = setTimeout(() => {
      if (child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      rejectProcess(new Error('The Ollama setup process timed out.'))
    }, timeoutMs)
    child.once('close', (code) => {
      clearTimeout(timeout)
      code === 0 ? resolveProcess(output) : rejectProcess(new Error(`Ollama setup exited with code ${code}: ${output.slice(-1000)}`))
    })
  })
}

async function waitForOllama(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return response.json()
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  }
  throw new Error('Ollama did not start. Check Windows security prompts and try again.')
}

async function isOllamaAvailable(url) {
  try {
    const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2500) })
    return response.ok
  } catch {
    return false
  }
}

async function pullOllamaModel(url) {
  const response = await fetch(`${url}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DEFAULT_OLLAMA_MODEL, stream: true })
  })
  if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status}).`)

  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      const progress = JSON.parse(line)
      if (progress.error) throw new Error(progress.error)
      const percent = progress.total ? Math.floor(progress.completed * 100 / progress.total) : 0
      setLocalModelStatus({ ready: false, phase: progress.status || 'Downloading Qwen2.5 3B', percent, error: '' })
    }
  }
  if (pending.trim()) {
    const progress = JSON.parse(pending)
    if (progress.error) throw new Error(progress.error)
  }
}

async function prepareLocalModel() {
  setLocalModelStatus({ ready: false, phase: 'Preparing Ollama', error: '' })
  let ollamaExecutable = findInstalledOllama()
  if (!ollamaExecutable) {
    setLocalModelStatus({ ready: false, phase: 'Installing Ollama automatically', error: '' })
    await runHiddenProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', "$ProgressPreference='SilentlyContinue'; irm 'https://ollama.com/install.ps1' | iex"
    ])
    ollamaExecutable = findInstalledOllama()
    if (!ollamaExecutable) throw new Error('Ollama installer finished but ollama.exe was not found.')
  }

  let url = 'http://127.0.0.1:11434'
  let tags
  try {
    tags = await waitForOllama(url, 3000)
  } catch {
    const port = await findAvailablePort()
    url = `http://127.0.0.1:${port}`
    const ollamaRoot = require('path').dirname(ollamaExecutable)
    ollamaProcess = spawn(ollamaExecutable, ['serve'], {
      cwd: ollamaRoot,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_NO_CLOUD: '1', OLLAMA_KEEP_ALIVE: '-1' }
    })
    tags = await waitForOllama(url)
  }

  if (!tags.models?.some(({ name }) => name === DEFAULT_OLLAMA_MODEL)) {
    setLocalModelStatus({ ready: false, phase: 'Downloading Qwen2.5 3B', percent: 0, error: '' })
    await pullOllamaModel(url)
  }

  const savedAI = setAISettings({
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: DEFAULT_OLLAMA_MODEL,
    geminiModel: getSettings().ai.geminiModel
  })
  configureAI({ ...savedAI, ollamaUrl: url })
  setLocalModelStatus({ ready: true, phase: 'Qwen2.5 3B is ready', error: '' })
}

function startWakeAssetServer() {
  const modelRoot = app.isPackaged
    ? join(process.resourcesPath, 'wakeword')
    : join(app.getAppPath(), 'src', 'asset', 'openwakeword')
  const rendererRoot = join(app.getAppPath(), 'out', 'renderer')
  wakeAssetServer = createServer(async (request, response) => {
    const origin = request.headers.origin
    const isLocalOrigin = !origin || origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    if (origin && isLocalOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
    }
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end()
      return
    }

    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      let filePath
      if (pathname.startsWith('/models/')) {
        const filename = pathname.slice('/models/'.length)
        if (!wakeModelFiles.has(filename)) {
          response.writeHead(404).end()
          return
        }
        filePath = join(modelRoot, filename)
      } else if (pathname.startsWith('/ort/')) {
        const filename = pathname.slice('/ort/'.length)
        filePath = wakeWasmPaths.get(filename)
        if (!filePath) {
          response.writeHead(404).end()
          return
        }
      } else {
        const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
        filePath = resolve(rendererRoot, relativePath)
        if (filePath !== rendererRoot && !filePath.startsWith(`${rendererRoot}${sep}`)) {
          response.writeHead(404).end()
          return
        }
      }

      const contents = await readFile(filePath)
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm'
      }
      response.setHeader('Content-Type', mimeTypes[extname(filePath)] ?? 'application/octet-stream')
      response.setHeader('Content-Length', contents.length)
      response.writeHead(200)
      response.end(request.method === 'HEAD' ? undefined : contents)
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end()
      if (error.code !== 'ENOENT') console.error('[wake-assets] request failed:', error.message)
    }
  })

  return new Promise((resolveServer, reject) => {
    wakeAssetServer.once('error', reject)
    wakeAssetServer.listen(0, '127.0.0.1', () => {
      wakeAssetServer.removeListener('error', reject)
      const { port } = wakeAssetServer.address()
      wakeAssetBaseUrl = `http://127.0.0.1:${port}`
      resolveServer()
    })
  })
}

function wakePet(action = { mode: 'wake' }) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    wakePending = action
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.setIgnoreMouseEvents(false)
  if (mainWindow.webContents.isLoading()) wakePending = action
  else mainWindow.webContents.send('wake-shortcut', action)
}

function sendPetAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    wakePending = action
    return
  }
  mainWindow.webContents.send('wake-shortcut', action)
}

async function handleGlobalShortcut() {
  if (shortcutCapturePending) return
  shortcutCapturePending = true
  const cursorAnchor = screen.getCursorScreenPoint()
  let selection = null
  try {
    selection = await captureSelectedText(clipboard)
  } catch (error) {
    console.warn('[selection] capture failed:', error.message)
  } finally {
    shortcutCapturePending = false
  }
  console.info(selection
    ? `[selection] captured ${selection.text.length} characters via ${selection.source}; target elevated=${selection.targetElevated}, app elevated=${selection.callerElevated}`
    : '[selection] no copyable selected text; waking pet only')
  if (!selection) {
    wakePet({ mode: 'wake' })
    return
  }
  const action = {
    mode: 'selection',
    text: selection.text,
    target: selection.target,
    editable: selection.editable,
    runtimeId: selection.runtimeId,
    anchor: selection.anchor
      ? screen.screenToDipPoint?.({ x: selection.anchor.x, y: selection.anchor.y }) ?? cursorAnchor
      : cursorAnchor
  }
  sendPetAction(action)
}

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
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })

  const rendererBase = (process.env.ELECTRON_RENDERER_URL || wakeAssetBaseUrl).replace(/\/+$/, '')
  win.loadURL(`${rendererBase}/`)
  mainWindow = win
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.send('wake-shortcut:status', wakeShortcutRegistered)
    win.webContents.send('wake-listener:active', true)
    win.webContents.send('local-model:status', localModelStatus)
    if (wakePending) {
      const action = wakePending
      wakePending = null
      win.webContents.send('wake-shortcut', action)
    }
  })

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
    if (mainWindow === win) mainWindow = null
  })
}

ipcMain.on('set-ignore-mouse', (e, ignore) => {
  BrowserWindow.fromWebContents(e.sender)?.setIgnoreMouseEvents(ignore, { forward: true })
})
ipcMain.on('focus-interactive', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return
  win.setIgnoreMouseEvents(false)
  win.show()
  win.focus()
})
ipcMain.on('wake-listener:active', (_e, active) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wake-listener:active', active === true)
  }
})
app.on('second-instance', () => wakePet())
ipcMain.on('wake-word:detected', (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) {
    console.info('[status] hey_jarvis wake word detected')
    wakePet({ mode: 'voice' })
  }
})
ipcMain.handle('wake-assets:get-url', () => wakeAssetBaseUrl)

ipcMain.on('quit', () => app.quit())
ipcMain.on('pet:sleep', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win !== mainWindow || win.isDestroyed()) return
  win.setIgnoreMouseEvents(true, { forward: true })
  win.hide()
})

ipcMain.handle('active-window:get', () => readActiveWindow())
ipcMain.handle('screen-text:get', () => readScreenText(1500))
ipcMain.handle('selection:insert', async (event, { target, runtimeId, text }) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false
  return insertTextAtTarget(clipboard, target, runtimeId, text)
})
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
  const pending = pendingConfirms.get(id)
  if (!pending) return
  pendingConfirms.delete(id)
  pending.resolve(ok === true)
  pending.restore()
})

let confirmSeq = 0
function askConfirm(sender, message, anchor) {
  return new Promise((resolve) => {
    const id = ++confirmSeq
    const win = BrowserWindow.fromWebContents(sender)
    if (!win || win.isDestroyed()) return resolve(false)
    const wasVisible = win.isVisible()
    const wasMinimized = win.isMinimized()
    const previousBounds = win.getBounds()
    const validAnchor = Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y)
    if (validAnchor) {
      const display = screen.getDisplayNearestPoint(anchor)
      const area = display.workArea
      const x = Math.max(area.x, Math.min(area.x + area.width - WIDTH, Math.round(anchor.x - WIDTH / 2)))
      const y = Math.max(area.y, Math.min(area.y + area.height - HEIGHT, Math.round(anchor.y - HEIGHT / 2)))
      win.setBounds({ ...previousBounds, x, y })
    }
    win.setIgnoreMouseEvents(false)
    win.show()
    win.focus()
    const restore = () => {
      if (win.isDestroyed()) return
      win.setBounds(previousBounds)
      if (win.webContents.isLoading()) return
      if (wasVisible) {
        win.setIgnoreMouseEvents(false)
        if (wasMinimized) win.minimize()
        else win.show()
      } else {
        win.setIgnoreMouseEvents(true, { forward: true })
        win.hide()
      }
    }
    pendingConfirms.set(id, { resolve, restore })
    sender.send('confirm-request', { id, message, anchor })
    setTimeout(() => {
      const pending = pendingConfirms.get(id)
      if (!pending) return
      pendingConfirms.delete(id)
      pending.resolve(false)
      pending.restore()
    }, 30000)
  })
}

ipcMain.handle('chat', async (e, { text, kind, id, selection }) => {
  const controller = new AbortController()
  chatControllers.set(id, controller)
  const send = (channel, payload) => {
    if (!e.sender.isDestroyed()) e.sender.send(channel, { id, payload })
  }
  try {
    if (app.isPackaged && !localModelStatus.ready) {
      throw new Error(localModelStatus.phase || 'The local language model is still being prepared.')
    }
    await chat(String(text).slice(0, 4000), kind, {
      signal: controller.signal,
      onChunk: (chunk) => send('chat-chunk', chunk),
      onTool: (label) => send('chat-tool', label),
      onReset: () => send('chat-reset'),
      confirm: (message) => askConfirm(e.sender, message, kind === 'selection' ? selection?.anchor : null)
    })
    if (controller.signal.aborted) return send('chat-cancelled')
    send('chat-done')
  } catch (err) {
    send(controller.signal.aborted ? 'chat-cancelled' : 'chat-error', err.message)
  } finally {
    chatControllers.delete(id)
  }
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isPetWindow = BrowserWindow.fromWebContents(webContents) === mainWindow
    const requestsAudio = permission === 'media' && details.mediaTypes?.includes('audio')
    callback(isPetWindow && requestsAudio)
  })
  await startWakeAssetServer()
  const installerGeminiKey = process.env.DESKTOP_PET_INSTALL_GEMINI_KEY || ''
  delete process.env.DESKTOP_PET_INSTALL_GEMINI_KEY
  if (installerGeminiKey) {
    const currentAI = getSettings().ai
    setAISettings({
      geminiApiKey: installerGeminiKey,
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      geminiModel: currentAI.geminiModel
    })
  }
  let aiSettings = getSettings().ai
  if (app.isPackaged) {
    aiSettings = setAISettings({
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      geminiModel: aiSettings.geminiModel
    })
  } else if (!(await isOllamaAvailable(aiSettings.ollamaUrl)) && aiSettings.ollamaUrl !== 'http://127.0.0.1:11434') {
    if (await isOllamaAvailable('http://127.0.0.1:11434')) {
      console.warn(`[settings] saved Ollama endpoint ${aiSettings.ollamaUrl} is stale; restored the default local Ollama endpoint`)
      aiSettings = setAISettings({
        ollamaUrl: 'http://127.0.0.1:11434',
        ollamaModel: aiSettings.ollamaModel || DEFAULT_OLLAMA_MODEL,
        geminiModel: aiSettings.geminiModel
      })
    }
  }
  configureAI(aiSettings)
  wakeShortcutRegistered = globalShortcut.register(WAKE_SHORTCUT, () => { void handleGlobalShortcut() })
  console.info(wakeShortcutRegistered ? `[status] global wake shortcut registered: ${WAKE_SHORTCUT}` : `[status] global wake shortcut unavailable: ${WAKE_SHORTCUT}`)
  createWindow()
  if (app.isPackaged) {
    void prepareLocalModel().catch((error) => {
      console.error('[local-model] automatic setup failed:', error)
      setLocalModelStatus({ ready: false, phase: 'Automatic Ollama setup failed', error: error.message })
    })
  }
  warmUpAppCatalog()
})
app.on('will-quit', () => {
  wakeAssetServer?.close()
  if (ollamaProcess?.pid) {
    spawnSync('taskkill.exe', ['/PID', String(ollamaProcess.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
  globalShortcut.unregisterAll()
})
app.on('window-all-closed', () => app.quit())
