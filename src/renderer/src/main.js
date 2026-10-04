import { mountPetModel } from './pet-model'

const bubble = document.getElementById('bubble')
const petEl = document.getElementById('pet')
mountPetModel(document.getElementById('pet-canvas')).catch((error) => console.error('[pet-model] failed to load:', error))
const form = document.getElementById('form')
const input = document.getElementById('input')
const confirmBox = document.getElementById('confirm')
const confirmMsg = document.getElementById('confirm-msg')
const settingsEl = document.getElementById('settings')
const stack = document.getElementById('stack')

// Only the pet, bubble and input receive the mouse; empty space is click-through
let dragging = false
document.querySelectorAll('.interactive').forEach((el) => {
  el.addEventListener('mouseenter', () => window.pet.setIgnoreMouse(false))
  el.addEventListener('mouseleave', () => {
    if (!dragging) window.pet.setIgnoreMouse(true)
  })
})

let hideTimer
let busy = false
let statusShown = false
let proactiveAttempt = 0
let activeChatId = 0
let chatSequence = 0
let activeChatKind = ''
let ttsEnabled = localStorage.getItem('ttsEnabled') !== 'false'
let speechGeneration = 0
let playingAudio = null
let playingAudioUrl = ''

function stopSpeech() {
  speechGeneration++
  if (playingAudio) {
    playingAudio.pause()
    playingAudio.src = ''
    playingAudio = null
  }
  if (playingAudioUrl) URL.revokeObjectURL(playingAudioUrl)
  playingAudioUrl = ''
}

async function speak(text) {
  const speechText = text
    .replace(/(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!ttsEnabled || !speechText) return
  const generation = ++speechGeneration
  try {
    const encoded = await window.pet.synthesizeSpeech(speechText.slice(0, 1500))
    if (generation !== speechGeneration) return
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
    const audio = new Audio(url)
    playingAudio = audio
    playingAudioUrl = url
    const cleanup = () => {
      if (playingAudio === audio) playingAudio = null
      if (playingAudioUrl === url) playingAudioUrl = ''
      URL.revokeObjectURL(url)
    }
    audio.addEventListener('ended', cleanup, { once: true })
    audio.addEventListener('error', cleanup, { once: true })
    await audio.play()
  } catch (error) {
    if (generation === speechGeneration) console.error('[tts] playback failed:', error)
  }
}

function cancelAutoChat() {
  if (!busy || activeChatKind !== 'auto') return
  window.pet.cancelChat(activeChatId)
  busy = false
  activeChatId = 0
  activeChatKind = ''
  bubble.textContent = ''
  statusShown = false
}

function ask(text, kind) {
  if (busy && kind !== 'auto') cancelAutoChat()
  if (busy) return
  stopSpeech()
  proactiveAttempt++
  busy = true
  const chatId = ++chatSequence
  activeChatId = chatId
  activeChatKind = kind
  lastActivity = Date.now()
  statusShown = false
  clearTimeout(hideTimer)
  bubble.textContent = ''
  bubble.classList.remove('hidden')
  petEl.classList.add('bounce')
  setTimeout(() => petEl.classList.remove('bounce'), 400)

  const finish = () => {
    if (activeChatId !== chatId) return
    busy = false
    activeChatKind = ''
    hideTimer = setTimeout(() => bubble.classList.add('hidden'), 8000)
  }
  let replyText = ''
  window.pet.chat(text, kind, chatId, {
    onChunk: (c) => {
      if (activeChatId !== chatId) return
      replyText += c
      if (statusShown) {
        bubble.textContent = ''
        statusShown = false
      }
      bubble.textContent += c
      bubble.scrollTop = bubble.scrollHeight
    },
    onTool: (label) => {
      if (activeChatId !== chatId) return
      if (!bubble.textContent || statusShown) {
        bubble.textContent = `${label}...`
        statusShown = true
      }
    },
    onDone: () => {
      if (activeChatId === chatId) speak(replyText)
      finish()
    },
    onReset: () => {
      if (activeChatId !== chatId) return
      replyText = ''
      bubble.textContent = ''
      statusShown = false
    },
    onError: (m) => {
      if (activeChatId !== chatId) return
      bubble.textContent = `Oops, something went wrong... (${m})`
      finish()
    }
  })
}

// Varied remark styles, so the pet does not sound the same every time
const STYLES = [
  'Make a playful joke about it.',
  'Ask the user a curious question about what they are doing.',
  'Give a tiny, genuinely useful tip related to it.',
  'Cheer the user on with lots of energy.',
  'Tease the user gently, like a mischievous pet.',
  'Share a random fun fact loosely related to it.',
  'React dramatically, like a quirky pet with big feelings.',
  'Say something warm and encouraging.',
  'Suggest a small stretch or water break, as a caring pet.',
  'Make a silly pun.'
]
let lastStyle = -1
function pickStyle() {
  let i
  do i = Math.floor(Math.random() * STYLES.length)
  while (i === lastStyle)
  lastStyle = i
  return STYLES[i]
}

function timeOfDay() {
  const h = new Date().getHours()
  return h < 6 ? 'late at night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'night'
}

let currentApp = ''
let appSince = Date.now()
let lastActivity = Date.now()

input.addEventListener('input', () => {
  lastActivity = Date.now()
  proactiveAttempt++
  stopSpeech()
  cancelAutoChat()
})

// Drag the pet with the left button to move the window; a real drag does not count as a click
let dragged = false
petEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  const startX = e.screenX
  const startY = e.screenY
  dragged = false
  dragging = true
  window.pet.setIgnoreMouse(false)
  window.pet.dragStart()
  const move = (m) => {
    if (Math.hypot(m.screenX - startX, m.screenY - startY) > 4) dragged = true
  }
  const up = () => {
    dragging = false
    window.pet.dragEnd()
    window.removeEventListener('mousemove', move)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up, { once: true })
})

petEl.addEventListener('click', () => {
  if (dragged) return (dragged = false)
  ask(`(The user just clicked you. ${pickStyle()} Keep it to one short sentence.)`, 'click')
})
// When the active window changes the pet speaks first (skipped while typing or busy)
window.pet.onActiveWindow(({ app, title }) => {
  if (app !== currentApp) {
    currentApp = app
    appSince = Date.now()
  }
  if (busy || document.activeElement === input) return
  const mins = Math.round((Date.now() - appSince) / 60000)
  const usage = mins >= 1 ? `, and has been in this app for about ${mins} minutes` : ''
  ask(`(It is ${timeOfDay()}. The user switched to the window "${title}" in the app "${app}"${usage}. ${pickStyle()} Keep it to one short sentence.)`, 'auto')
})

// If nothing has been said for a few minutes, the pet chats on its own about the window in front
let idleLimit = (3 + Math.random() * 4) * 60000
setInterval(async () => {
  if (busy || document.activeElement === input || Date.now() - lastActivity < idleLimit) return
  idleLimit = (3 + Math.random() * 4) * 60000
  const attempt = ++proactiveAttempt
  let screenText = ''
  try {
    screenText = await window.pet.readScreenText()
  } catch {}
  if (attempt !== proactiveAttempt || busy || document.activeElement === input) return

  let context = ''
  if (screenText?.trim()) {
    context = ` The screen shows: "${screenText.trim()}". Use this only as context for your remark.`
  } else {
    const win = await window.pet.getActiveWindow().catch(() => null)
    if (attempt !== proactiveAttempt || busy || document.activeElement === input) return
    if (win?.app && win.app !== currentApp) {
      currentApp = win.app
      appSince = Date.now()
    }
    const mins = Math.round((Date.now() - appSince) / 60000)
    context = win?.app
      ? ` The user is looking at the window "${win.title}" in the app "${win.app}"${mins >= 1 ? `, and has been in this app for about ${mins} minutes` : ''}.`
      : ''
  }
  ask(`(It is ${timeOfDay()}.${context} ${pickStyle()} Base your remark on this context. Keep it to one short sentence.)`, 'auto')
}, 30000)

// Risky tools ask the user for confirmation before running
window.pet.onConfirm(({ id, message }) => {
  confirmMsg.textContent = message
  confirmBox.classList.remove('hidden')
  const done = (ok) => {
    confirmBox.classList.add('hidden')
    window.pet.setIgnoreMouse(true)
    window.pet.respondConfirm(id, ok)
  }
  document.getElementById('confirm-yes').onclick = () => done(true)
  document.getElementById('confirm-no').onclick = () => done(false)
})

const TOOL_LABELS = {
  get_active_window: 'Check active window',
  read_screen_text: 'Read screen (OCR)',
  launch_app: 'Launch apps',
  read_file: 'Read files',
  run_command: 'Run cmd/PowerShell commands',
  open_system_panel: 'Open Task Manager / Control Panel / Settings',
  open_url: 'Open web pages',
  close_app: 'Close apps/tabs',
  memory: 'Save memories (disk)'
}

async function renderSettings() {
  const tools = await window.pet.getSettings()
  const sleep = document.createElement('div')
  sleep.id = 'sleep'
  sleep.textContent = 'Put pet to sleep'
  sleep.onclick = () => window.pet.quit()
  const speech = document.createElement('label')
  const speechToggle = document.createElement('input')
  speechToggle.type = 'checkbox'
  speechToggle.checked = ttsEnabled
  speechToggle.onchange = () => {
    ttsEnabled = speechToggle.checked
    localStorage.setItem('ttsEnabled', String(ttsEnabled))
    if (!ttsEnabled) stopSpeech()
  }
  speech.append(speechToggle, ' Speak replies')
  settingsEl.replaceChildren(
    ...Object.entries(TOOL_LABELS).map(([key, label]) => {
      const row = document.createElement('label')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = tools[key]
      box.onchange = () => window.pet.setSettings({ [key]: box.checked })
      row.append(box, ` ${label}`)
      return row
    }),
    speech,
    sleep
  )
}

// Right-click the pet to open or close the settings panel
petEl.addEventListener('contextmenu', () => {
  settingsEl.classList.toggle('hidden')
  if (!settingsEl.classList.contains('hidden')) renderSettings()
})

// The main process polls the global cursor, so this also works once the mouse has left the window
const NEAR_PX = 120
const SETTINGS_MARGIN = 16
const inside = (r, x, y, m = 0) => x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m

function onPointer({ x, y }) {
  const pet = petEl.getBoundingClientRect()
  const dx = Math.max(pet.left - x, 0, x - pet.right)
  const dy = Math.max(pet.top - y, 0, y - pet.bottom)
  const near = Math.hypot(dx, dy) < NEAR_PX || inside(form.getBoundingClientRect(), x, y)
  // The input shows near the pet and stays while it has focus or text
  if (near) form.classList.remove('away')
  else if (document.activeElement !== input && !input.value) form.classList.add('away')

  // The settings panel hides once the mouse is away from both the pet and the panel
  if (!settingsEl.classList.contains('hidden')) {
    const panel = settingsEl.getBoundingClientRect()
    const zone = {
      left: Math.min(pet.left, panel.left),
      top: Math.min(pet.top, panel.top),
      right: Math.max(pet.right, panel.right),
      bottom: Math.max(pet.bottom, panel.bottom)
    }
    if (!inside(zone, x, y, SETTINGS_MARGIN)) settingsEl.classList.add('hidden')
  }
}

// Polled global cursor (works outside the window); mousemove covers the case where polling is unavailable
let stackShift = 0

// Keep the stack on screen: flip it below the pet when there is no room above, and nudge it sideways at screen edges
function placeStack({ bounds, work }) {
  const height = stack.offsetHeight
  if (!height) return
  const gap = 12
  const freeAbove = bounds.y + petEl.getBoundingClientRect().top - work.y
  const freeBelow = work.y + work.height - (bounds.y + form.getBoundingClientRect().bottom)
  stack.classList.toggle('below', freeAbove < height + gap && freeBelow > freeAbove)
  const rect = stack.getBoundingClientRect()
  const margin = 8
  const viewportWidth = document.documentElement.clientWidth
  let shift = 0
  if (rect.left < margin) shift = margin - rect.left
  else if (rect.right > viewportWidth - margin) shift = viewportWidth - margin - rect.right
  stackShift += shift
  stack.style.setProperty('--shift', `${stackShift}px`)
}

window.pet.onCursor?.((p) => {
  onPointer(p)
  placeStack(p)
})
document.addEventListener('mousemove', (e) => onPointer({ x: e.clientX, y: e.clientY }))

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  ask(text, 'text')
})
