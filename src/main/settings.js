import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

const DEFAULTS = {
  ai: {
    geminiModel: 'gemini-2.5-flash',
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen2.5:3b'
  },
  tools: { get_active_window: true, read_screen_text: false, launch_app: false, read_file: false, run_command: false, set_brightness: true, open_system_panel: true, volume: true, memory: true, open_url: true, close_app: true },
  // App shortcuts: name the model uses -> executable (edit only in settings.json)
  allowedApps: { notepad: 'notepad.exe', calculator: 'calc.exe', paint: 'mspaint.exe' },
  readRoots: []
}

let cache
let encryptedGeminiApiKey = ''

const file = () => join(app.getPath('userData'), 'settings.json')

export function getSettings() {
  if (cache) return cache
  let saved = {}
  try {
    saved = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {}
  encryptedGeminiApiKey = saved.ai?.geminiApiKeyEncrypted || ''
  let geminiApiKey = ''
  if (encryptedGeminiApiKey && safeStorage.isEncryptionAvailable()) {
    try {
      geminiApiKey = safeStorage.decryptString(Buffer.from(encryptedGeminiApiKey, 'base64'))
    } catch (error) {
      console.warn('[settings] saved Gemini key could not be decrypted:', error.message)
    }
  }
  cache = {
    ...DEFAULTS,
    ...saved,
    ai: { ...DEFAULTS.ai, ...saved.ai, geminiApiKey },
    tools: { ...DEFAULTS.tools, ...saved.tools, volume: true, set_brightness: true }
  }
  delete cache.ai.geminiApiKeyEncrypted
  if (!cache.readRoots.length) cache.readRoots = [app.getPath('documents')]
  return cache
}

function saveSettings() {
  const settings = getSettings()
  const saved = { ...settings, ai: { ...settings.ai, geminiApiKeyEncrypted: encryptedGeminiApiKey } }
  delete saved.ai.geminiApiKey
  writeFileSync(file(), JSON.stringify(saved, null, 2))
}

export function setAISettings(values) {
  const settings = getSettings()
  const ollamaUrl = String(values?.ollamaUrl ?? settings.ai.ollamaUrl).trim().replace(/\/+$/, '')
  let parsedUrl
  try {
    parsedUrl = new URL(ollamaUrl)
  } catch {
    throw new Error('Enter a valid Ollama server URL.')
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Ollama URL must use HTTP or HTTPS.')

  const geminiModel = String(values?.geminiModel ?? settings.ai.geminiModel).trim()
  const ollamaModel = String(values?.ollamaModel ?? settings.ai.ollamaModel).trim()
  if (!geminiModel || !ollamaModel) throw new Error('Choose a Gemini model and an Ollama model.')

  if (values?.clearGeminiApiKey === true) {
    encryptedGeminiApiKey = ''
    settings.ai.geminiApiKey = ''
  } else if (typeof values?.geminiApiKey === 'string' && values.geminiApiKey.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is unavailable on this system.')
    settings.ai.geminiApiKey = values.geminiApiKey.trim()
    encryptedGeminiApiKey = safeStorage.encryptString(settings.ai.geminiApiKey).toString('base64')
  }

  settings.ai.geminiModel = geminiModel
  settings.ai.ollamaUrl = ollamaUrl
  settings.ai.ollamaModel = ollamaModel
  saveSettings()
  return settings.ai
}

// The renderer can only change tool on/off toggles
export function setToolToggles(tools) {
  const s = getSettings()
  for (const k of Object.keys(s.tools)) if (typeof tools?.[k] === 'boolean') s.tools[k] = tools[k]
  saveSettings()
  return s
}
