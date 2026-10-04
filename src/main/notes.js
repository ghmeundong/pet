import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

const MAX_NOTES = 100
let cache

const file = () => join(app.getPath('userData'), 'notes.json')

function load() {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache
}

const save = () => writeFileSync(file(), JSON.stringify(cache, null, 2))

export const listNotes = () => ({ ...load() })

export function setNote(key, value) {
  const notes = load()
  if (!(key in notes) && Object.keys(notes).length >= MAX_NOTES) return false
  notes[key] = { value, savedAt: new Date().toISOString() }
  save()
  return true
}

export function deleteNote(key) {
  const notes = load()
  const had = key in notes
  delete notes[key]
  if (had) save()
  return had
}

// One-line digest for the system prompt
export function notesPrompt() {
  const entries = Object.entries(load())
  return entries.length ? entries.map(([k, n]) => `${k}=${n.value}`).join(', ').slice(0, 800) : ''
}
