import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

const DEFAULTS = {
  tools: { get_active_window: true, read_screen_text: false, launch_app: false, read_file: false, run_command: false, set_brightness: true, open_system_panel: true, volume: true, memory: true, open_url: true, close_app: true },
  // App shortcuts: name the model uses -> executable (edit only in settings.json)
  allowedApps: { notepad: 'notepad.exe', calculator: 'calc.exe', paint: 'mspaint.exe' },
  readRoots: []
}

let cache

const file = () => join(app.getPath('userData'), 'settings.json')

export function getSettings() {
  if (cache) return cache
  let saved = {}
  try {
    saved = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {}
  cache = {
    ...DEFAULTS,
    ...saved,
    tools: { ...DEFAULTS.tools, ...saved.tools, volume: true, set_brightness: true }
  }
  if (!cache.readRoots.length) cache.readRoots = [app.getPath('documents')]
  return cache
}

// The renderer can only change tool on/off toggles
export function setToolToggles(tools) {
  const s = getSettings()
  for (const k of Object.keys(s.tools)) if (typeof tools?.[k] === 'boolean') s.tools[k] = tools[k]
  writeFileSync(file(), JSON.stringify(s, null, 2))
  return s
}
