import { mountPetModel } from './pet-model'
import { createWakeWordController } from './wake-word'

const bubble = document.getElementById('bubble')
const petEl = document.getElementById('pet')
const uiRoot = document.getElementById('ui-root')
const setupStatus = document.getElementById('setup-status')
const setupPhase = document.getElementById('setup-phase')
const setupProgress = document.getElementById('setup-progress')
const setupOverallPercent = document.getElementById('setup-overall-percent')
const setupDownloadSize = document.getElementById('setup-download-size')
const setupDownloads = document.getElementById('setup-downloads')
const setupLog = document.getElementById('setup-log')
const setupError = document.getElementById('setup-error')
const setupSteps = {
  ollama: document.getElementById('setup-step-ollama'),
  model: document.getElementById('setup-step-model')
}
const formatBytes = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
let renderedSetupLogCount = 0
const loadRangeSetting = (key, fallback, min, max) => {
  const stored = localStorage.getItem(key)
  const value = Number(stored)
  return stored === null || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, value))
}
let petScale = loadRangeSetting('petScale', 1, 0.6, 1.2)
let inputScale = loadRangeSetting('inputScale', 1, 0.6, 1.2)
let masterVolume = loadRangeSetting('masterVolume', 1, 0, 1)
uiRoot.style.setProperty('--ui-scale', String(inputScale))
const updatePetScale = () => uiRoot.style.setProperty('--pet-model-scale', String(petScale / inputScale))
updatePetScale()
let ttsPlaying = false
let setPetPulsing = () => {}
let setPetThinking = () => {}
let hitTestPet = () => false
mountPetModel(document.getElementById('pet-canvas'), { showcase: true })
  .then((model) => {
    setPetPulsing = model.setPulsing
    setPetThinking = model.setThinking
    hitTestPet = model.hitTest
    setPetPulsing(ttsPlaying)
    setPetThinking(busy)
  })
  .catch((error) => console.error('[pet-model] failed to load:', error))
const form = document.getElementById('form')
const input = document.getElementById('input')
const confirmBox = document.getElementById('confirm')
const confirmMsg = document.getElementById('confirm-msg')
const settingsEl = document.getElementById('settings')
const stack = document.getElementById('stack')
const slashSuggestions = document.getElementById('slash-suggestions')
const SLASH_COMMANDS = [
  { command: '/chat ', label: 'Chat without tools', detail: 'Answer directly without choosing or running tools.' },
  { command: '/open ', label: 'Open a website or app', detail: 'Try an exact URL or installed app name.' },
  { command: '/cmd ', label: 'Run a command', detail: 'Run cmd, or choose /cmd ps for PowerShell.' },
  { command: '/screen', label: 'Read screen', detail: 'Extract visible text from the screen.' },
  { command: '/read ', label: 'Read a file', detail: 'Requires confirmation before reading.' },
  { command: '/panel ', label: 'Open a system panel', detail: 'Examples: settings, wifi, task manager.' },
  { command: '/close ', label: 'Close an app or tab', detail: 'Requires confirmation before closing.' }
]
let selectedSlashCommand = 0

function chooseSlashCommand(command) {
  input.value = command
  input.focus()
  input.setSelectionRange(command.length, command.length)
  slashSuggestions.classList.add('hidden')
  lastActivity = Date.now()
}

function updateSlashSuggestions() {
  const value = input.value
  if (!value.startsWith('/') || /\s/.test(value)) {
    slashSuggestions.classList.add('hidden')
    slashSuggestions.replaceChildren()
    return
  }

  const query = value.slice(1).toLowerCase()
  const matches = SLASH_COMMANDS.filter(({ command }) => command.slice(1).trim().startsWith(query))
  if (!matches.length) {
    slashSuggestions.classList.add('hidden')
    slashSuggestions.replaceChildren()
    return
  }

  selectedSlashCommand = Math.min(selectedSlashCommand, matches.length - 1)
  slashSuggestions.replaceChildren(...matches.map((item, index) => {
    const option = document.createElement('button')
    option.type = 'button'
    option.className = 'slash-option'
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', String(index === selectedSlashCommand))
    const title = document.createElement('strong')
    title.textContent = item.command.trim()
    const detail = document.createElement('span')
    detail.textContent = `${item.label} · ${item.detail}`
    option.append(title, detail)
    option.addEventListener('mousedown', (event) => event.preventDefault())
    option.addEventListener('click', () => chooseSlashCommand(item.command))
    return option
  }))
  slashSuggestions.classList.remove('hidden')
}

input.addEventListener('keydown', (event) => {
  if (busy && event.key === 'Enter') {
    event.preventDefault()
    return
  }
  if (slashSuggestions.classList.contains('hidden')) return
  const options = [...slashSuggestions.querySelectorAll('.slash-option')]
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    selectedSlashCommand = (selectedSlashCommand + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === selectedSlashCommand)))
  } else if ((event.key === 'Enter' || event.key === 'Tab') && options.length) {
    event.preventDefault()
    const selected = SLASH_COMMANDS.find(({ command }) => command.trim() === options[selectedSlashCommand].querySelector('strong').textContent)
    if (selected) chooseSlashCommand(selected.command)
  } else if (event.key === 'Escape') {
    slashSuggestions.classList.add('hidden')
  }
})

// Only interactive areas receive mouse input; the rest of the desktop remains click-through.
let dragging = false
let mouseIgnored = true

function setMouseIgnored(ignore) {
  if (mouseIgnored === ignore || dragging) return
  mouseIgnored = ignore
  window.pet.setIgnoreMouse(ignore)
}

function focusInputFromPointer() {
  setMouseIgnored(false)
  window.pet.focusInteractive()
  input.focus()
}

form.addEventListener('pointerdown', focusInputFromPointer)
input.addEventListener('focus', () => {
  setMouseIgnored(false)
  closeSettingsPanel()
})

function closeSettingsPanel() {
  const wasOpen = !settingsEl.classList.contains('hidden')
  settingsEl.classList.add('hidden')
  uiRoot.classList.remove('settings-open', 'settings-positioning')
  settingsStackSide = null
  clearTimeout(settingsHideTimer)
  settingsHideTimer = null
  if (wasOpen && lastCursorPosition) placeStack(lastCursorPosition)
}

let hideTimer
let busy = false
function setBusy(active) {
  busy = active
  setPetThinking(active)
}
let statusShown = false
let proactiveAttempt = 0
let activeChatId = 0
let chatSequence = 0
let activeChatKind = ''
let ttsEnabled = localStorage.getItem('ttsEnabled') !== 'false'
let speechGeneration = 0
let playingAudio = null
let playingAudioUrl = ''
let finishAudioPlayback = null
let voiceRecognition = null
let voiceListening = false
let voiceSession = 0
let voiceStatusTimer

function stopSpeech() {
  speechGeneration++
  ttsPlaying = false
  setPetPulsing(false)
  const finishPlayback = finishAudioPlayback
  finishAudioPlayback = null
  if (playingAudio) {
    playingAudio.pause()
    playingAudio.src = ''
    playingAudio = null
  }
  if (playingAudioUrl) URL.revokeObjectURL(playingAudioUrl)
  playingAudioUrl = ''
  finishPlayback?.()
}

function showVoiceStatus(message, duration = 5000) {
  clearTimeout(voiceStatusTimer)
  bubble.textContent = message
  bubble.classList.remove('hidden')
  voiceStatusTimer = setTimeout(() => {
    if (!voiceListening && !busy) bubble.classList.add('hidden')
  }, duration)
}

let wakeWordController = null
let wakeWordActive = true
let wakeShortcutAvailable = true
window.pet.onWakeShortcutStatus((registered) => {
  wakeShortcutAvailable = registered === true
  if (!wakeShortcutAvailable) showVoiceStatus('Ctrl+Shift+Space is unavailable. Close other Desktop Pet instances and restart the app.')
})
window.pet.onLocalModelStatus(({ ready, stage, phase, percent, overallPercent, completedBytes, totalBytes, downloads = [], logs = [], error }) => {
  const shouldFollowSetupLog = setupLog.scrollHeight - setupLog.scrollTop - setupLog.clientHeight < 24
  const isInitialLogRender = renderedSetupLogCount === 0
  if (logs.length < renderedSetupLogCount) {
    setupLog.replaceChildren()
    renderedSetupLogCount = 0
  }
  for (const entry of logs.slice(renderedSetupLogCount)) {
    const line = document.createElement('li')
    line.textContent = entry
    setupLog.append(line)
  }
  renderedSetupLogCount = logs.length
  if (logs.length && (shouldFollowSetupLog || isInitialLogRender)) setupLog.scrollTop = setupLog.scrollHeight
  if (ready) {
    setupStatus.classList.add('hidden')
    showVoiceStatus('Qwen2.5 3B is ready. Jarvis is listening.')
    return
  }
  setupStatus.classList.remove('hidden')
  setupPhase.textContent = phase || 'Preparing Ollama...'
  if (Number.isFinite(overallPercent)) setupProgress.value = Math.max(0, Math.min(100, overallPercent))
  else setupProgress.removeAttribute('value')
  setupOverallPercent.textContent = Number.isFinite(overallPercent) ? `${Math.round(overallPercent)}%` : '--'
  const hasDownloadSize = Number.isFinite(completedBytes) && Number.isFinite(totalBytes) && totalBytes > 0
  setupDownloadSize.classList.toggle('hidden', !hasDownloadSize)
  setupDownloadSize.textContent = hasDownloadSize
    ? `Current download: ${formatBytes(completedBytes)} / ${formatBytes(totalBytes)}`
    : ''
  const stageIsComplete = (step) => stage === 'complete' || (step === 'ollama' && stage === 'model')
  for (const [step, element] of Object.entries(setupSteps)) {
    const state = error && stage === step
      ? 'Failed'
      : stageIsComplete(step) || (step === 'ollama' && phase === 'Ollama already installed')
        ? 'Complete'
        : stage === step
          ? 'In progress'
          : 'Waiting'
    element.classList.toggle('complete', state === 'Complete')
    element.classList.toggle('active', state === 'In progress')
    element.classList.toggle('failed', state === 'Failed')
    element.querySelector('.setup-step-state').textContent = state
    const detail = element.querySelector('small')
    if (step === 'ollama' && stage === step) {
      detail.textContent = phase || 'Preparing Ollama'
    } else if (step === 'model' && stage === step) {
      detail.textContent = phase || 'Preparing Qwen2.5 3B'
    } else if (step === 'ollama' && state === 'Complete') {
      detail.textContent = 'Installed and ready'
    } else if (step === 'model' && state === 'Complete') {
      detail.textContent = 'Downloaded and ready'
    } else if (state === 'Waiting') {
      detail.textContent = step === 'ollama' ? 'Waiting to install' : 'Waiting to download'
    }
  }
  setupDownloads.replaceChildren()
  setupDownloads.classList.toggle('hidden', downloads.length === 0)
  for (const download of downloads) {
    const item = document.createElement('li')
    item.className = 'setup-download-item'
    const name = document.createElement('strong')
    name.textContent = download.name || 'Download file'
    const file = document.createElement('small')
    file.textContent = `File: ${download.file || download.name || 'Unknown'}`
    const details = document.createElement('small')
    details.textContent = Number.isFinite(download.totalBytes) && download.totalBytes > 0
      ? `${download.status || 'Downloading'} · ${formatBytes(download.completedBytes || 0)} / ${formatBytes(download.totalBytes)}`
      : `${download.status || 'Downloading'} · Total size unavailable`
    item.append(name, file, details)
    if (Number.isFinite(download.totalBytes) && download.totalBytes > 0) {
      const progressBar = document.createElement('progress')
      progressBar.max = 100
      progressBar.value = Math.min(100, (download.completedBytes || 0) * 100 / download.totalBytes)
      item.append(progressBar)
    }
    setupDownloads.append(item)
  }
  setupError.textContent = error || ''
  setupError.classList.toggle('hidden', !error)
  const detail = error || `${phase || 'Preparing local model'}${Number.isFinite(percent) ? ` (${percent}%)` : ''}`
  showVoiceStatus(`Automatic setup: ${detail}`, 15000)
})
window.pet.onWakeListenerActive((active) => {
  wakeWordActive = active === true
  if (wakeWordController) void wakeWordController.setActive(wakeWordActive)
})
window.pet.getWakeAssetsUrl().then((assetUrl) => {
  wakeWordController = createWakeWordController(assetUrl, {
    onDetected: () => window.pet.wakeWordDetected(),
    onReady: () => showVoiceStatus(wakeShortcutAvailable
      ? 'Jarvis is listening. Say "Hey Jarvis" or press Ctrl+Shift+Space.'
      : 'Jarvis is listening for "Hey Jarvis", but Ctrl+Shift+Space is in use by another app.'),
    onError: (error) => {
      console.error('[wake-word] browser engine failed:', error)
      if (error.name === 'NotAllowedError') {
        showVoiceStatus('Microphone permission was denied. Enable microphone access to use Jarvis.')
      } else {
        showVoiceStatus(`Jarvis could not start listening: ${error.message || error}`)
      }
    }
  })
  return wakeWordController.setActive(wakeWordActive)
}).catch((error) => console.error('[wake-word] initialization failed:', error))

function stopVoiceInput({ hideStatus = true } = {}) {
  voiceListening = false
  voiceSession++
  clearTimeout(voiceStatusTimer)
  const recognition = voiceRecognition
  voiceRecognition = null
  if (recognition) {
    recognition.onend = null
    try { recognition.stop() } catch {}
  }
  window.pet.setWakeListenerActive(true)
  if (hideStatus && !busy) bubble.classList.add('hidden')
}

function startVoiceInput() {
  if (voiceListening) {
    stopVoiceInput()
    return
  }
  if (busy) return
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SpeechRecognition) {
    window.pet.setWakeListenerActive(true)
    form.classList.remove('away')
    input.focus()
    console.warn('[voice] SpeechRecognition is unavailable; falling back to keyboard input')
    showVoiceStatus('Speech recognition is unavailable here. Type your message instead.')
    return
  }

  stopSpeech()
  window.pet.setWakeListenerActive(false)
  proactiveAttempt++
  lastActivity = Date.now()
  form.classList.remove('away')
  window.pet.setIgnoreMouse(false)
  input.focus()

  const sessionId = ++voiceSession
  let recognition
  try {
    recognition = new SpeechRecognition()
  } catch (error) {
    window.pet.setWakeListenerActive(true)
    console.error('[voice] failed to create speech recognizer:', error)
    showVoiceStatus('Could not initialize voice input. Type your message instead.')
    return
  }
  voiceRecognition = recognition
  voiceListening = true
  recognition.lang = 'en-US'
  recognition.continuous = false
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  bubble.textContent = 'Listening in English. Speech may use an online service. Press Ctrl+Shift+Space to cancel.'
  bubble.classList.remove('hidden')
  console.info('[status] voice input listening (en-US)')

  recognition.onresult = (event) => {
    if (!voiceListening || sessionId !== voiceSession) return
    const transcript = event.results?.[0]?.[0]?.transcript?.trim()
    voiceListening = false
    voiceRecognition = null
    clearTimeout(voiceStatusTimer)
    bubble.classList.add('hidden')
    if (transcript) ask(transcript, 'text')
    else {
      window.pet.setWakeListenerActive(true)
      showVoiceStatus('No speech recognized. Press Ctrl+Shift+Space to try again.')
    }
  }
  recognition.onerror = (event) => {
    if (!voiceListening || sessionId !== voiceSession) return
    voiceListening = false
    voiceRecognition = null
    window.pet.setWakeListenerActive(true)
    console.warn(`[voice] speech recognition error: ${event.error}`)
    const messages = {
      'not-allowed': 'Microphone permission was denied. Check Windows microphone privacy settings.',
      'service-not-allowed': 'Speech recognition service is unavailable.',
      'audio-capture': 'No usable microphone was found.',
      network: 'Speech recognition needs an internet connection.',
      'no-speech': 'No speech detected. Press Ctrl+Shift+Space to try again.'
    }
    showVoiceStatus(messages[event.error] ?? `Speech recognition error: ${event.error}`)
  }
  recognition.onend = () => {
    if (!voiceListening || sessionId !== voiceSession) return
    voiceListening = false
    voiceRecognition = null
    window.pet.setWakeListenerActive(true)
    showVoiceStatus('Listening ended. Press Ctrl+Shift+Space to try again.')
  }
  try {
    recognition.start()
  } catch (error) {
    voiceListening = false
    voiceRecognition = null
    window.pet.setWakeListenerActive(true)
    console.error('[voice] failed to start speech recognition:', error)
    showVoiceStatus('Could not start voice input. Check microphone access and try again.')
  }
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
    audio.volume = masterVolume
    playingAudio = audio
    playingAudioUrl = url
    let resolvePlayback
    const playbackEnded = new Promise((resolve) => { resolvePlayback = resolve })
    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      audio.removeEventListener('playing', startPlayback)
      audio.removeEventListener('ended', finishPlayback)
      audio.removeEventListener('error', finishPlayback)
      audio.removeEventListener('abort', finishPlayback)
      if (playingAudio === audio) {
        playingAudio = null
        ttsPlaying = false
        setPetPulsing(false)
      }
      if (playingAudioUrl === url) playingAudioUrl = ''
      URL.revokeObjectURL(url)
    }
    const startPlayback = () => {
      if (playingAudio !== audio) return
      ttsPlaying = true
      setPetPulsing(true)
    }
    const finishPlayback = () => {
      cleanup()
      if (finishAudioPlayback === finishPlayback) finishAudioPlayback = null
      resolvePlayback()
    }
    finishAudioPlayback = finishPlayback
    audio.addEventListener('playing', startPlayback)
    audio.addEventListener('ended', finishPlayback)
    audio.addEventListener('error', finishPlayback)
    audio.addEventListener('abort', finishPlayback)
    await audio.play()
    await playbackEnded
  } catch (error) {
    if (generation === speechGeneration) {
      console.error('[tts] playback failed:', error)
      finishAudioPlayback?.()
    }
  }
}

function cancelAutoChat() {
  if (!busy || activeChatKind !== 'auto') return
  window.pet.cancelChat(activeChatId)
  setBusy(false)
  activeChatId = 0
  activeChatKind = ''
  bubble.textContent = ''
  statusShown = false
}

function sleepPet() {
  stopSpeech()
  if (voiceListening) stopVoiceInput()
  else window.pet.setWakeListenerActive(true)
  if (busy) {
    window.pet.cancelChat(activeChatId)
    setBusy(false)
    activeChatId = 0
    activeChatKind = ''
  }
  proactiveAttempt++
  bubble.classList.add('hidden')
  settingsEl.classList.add('hidden')
  window.pet.sleep()
}

function ask(text, kind, selection = null) {
  if (busy && kind !== 'auto') cancelAutoChat()
  if (busy) return
  window.pet.setWakeListenerActive(false)
  stopSpeech()
  proactiveAttempt++
  setBusy(true)
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
    setBusy(false)
    activeChatKind = ''
    window.pet.setWakeListenerActive(true)
    hideTimer = setTimeout(() => bubble.classList.add('hidden'), 8000)
  }
  let replyText = ''
  let toolsUsed = false
  window.pet.chat(text, kind, chatId, {
    onChunk: (c) => {
      if (activeChatId !== chatId) return
      if (c) setPetThinking(false)
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
      toolsUsed = true
      if (!bubble.textContent || statusShown) {
        bubble.textContent = `${label}...`
        statusShown = true
      }
    },
    onDone: async () => {
      if (activeChatId !== chatId) return
      const answer = replyText.trim()
      if (kind === 'selection' && selection?.editable && answer && !toolsUsed) {
        await window.pet.insertSelectionAnswer(selection.target, selection.runtimeId, answer).catch(() => false)
      }
      await speak(replyText)
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
  }, kind === 'selection' ? selection : null)
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
  if (voiceListening) stopVoiceInput()
  lastActivity = Date.now()
  proactiveAttempt++
  stopSpeech()
  cancelAutoChat()
  selectedSlashCommand = 0
  updateSlashSuggestions()
})

window.pet.onWakeShortcut((action = { mode: 'wake' }) => {
  if (action.mode === 'voice') {
    startVoiceInput()
    return
  }
  if (action.mode === 'selection' && typeof action.text === 'string' && action.text.trim()) {
    stopVoiceInput({ hideStatus: false })
    ask(action.text.trim(), 'selection', action)
    return
  }
  focusInputFromPointer()
  showVoiceStatus('Jarvis is awake and listening for "Hey Jarvis".')
})

// Drag the pet with the left button to move the window; a real drag does not count as a click
let dragged = false
petEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !hitTestPet(e.clientX, e.clientY)) return
  const startX = e.screenX
  const startY = e.screenY
  dragged = false
  dragging = true
  mouseIgnored = false
  window.pet.setIgnoreMouse(false)
  window.pet.dragStart()
  const move = (m) => {
    if (Math.hypot(m.screenX - startX, m.screenY - startY) > 4) dragged = true
  }
  const up = () => {
    dragging = false
    window.pet.dragEnd()
    mouseIgnored = false
    window.removeEventListener('mousemove', move)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up, { once: true })
})

petEl.addEventListener('click', (e) => {
  if (!hitTestPet(e.clientX, e.clientY)) return
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
  uiRoot.classList.add('confirming')
  confirmMsg.textContent = message
  confirmBox.classList.remove('hidden')
  const done = (ok) => {
    confirmBox.classList.add('hidden')
    uiRoot.classList.remove('confirming')
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
  const createRangeSetting = (labelText, key, value, min, max, format, onInput) => {
    const row = document.createElement('div')
    row.className = 'setting-range'
    const header = document.createElement('div')
    header.className = 'setting-range-header'
    const label = document.createElement('label')
    const input = document.createElement('input')
    const output = document.createElement('output')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = '1'
    input.value = String(Math.round(value * 100))
    input.setAttribute('aria-label', labelText)
    label.textContent = labelText
    output.textContent = format(value)
    input.addEventListener('input', () => {
      const nextValue = Number(input.value) / 100
      output.textContent = format(nextValue)
      localStorage.setItem(key, String(nextValue))
      onInput(nextValue)
    })
    header.append(label, output)
    row.append(header, input)
    return row
  }
  const sizeSetting = createRangeSetting('Pet size', 'petScale', petScale, 60, 120, (value) => `${Math.round(value * 100)}%`, (value) => {
    petScale = value
    uiRoot.style.setProperty('--pet-model-scale', String(petScale / inputScale))
  })
  const inputSizeSetting = createRangeSetting('Input size', 'inputScale', inputScale, 60, 120, (value) => `${Math.round(value * 100)}%`, (value) => {
    inputScale = value
    uiRoot.style.setProperty('--ui-scale', String(value))
    uiRoot.style.setProperty('--pet-model-scale', String(petScale / inputScale))
  })
  const volumeSetting = createRangeSetting('Master volume', 'masterVolume', masterVolume, 0, 100, (value) => `${Math.round(value * 100)}%`, (value) => {
    masterVolume = value
    if (playingAudio) playingAudio.volume = value
  })
  const sleep = document.createElement('div')
  sleep.id = 'sleep'
  sleep.textContent = 'Sleep (keep wake listener active)'
  sleep.onclick = sleepPet
  const quit = document.createElement('div')
  quit.id = 'quit'
  quit.textContent = 'Quit Desktop Pet'
  quit.onclick = () => window.pet.quit()
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
    sizeSetting,
    inputSizeSetting,
    volumeSetting,
    speech,
    sleep,
    quit
  )
}

// Right-click the pet to open or close the settings panel
petEl.addEventListener('contextmenu', (e) => {
  if (!hitTestPet(e.clientX, e.clientY)) return
  if (settingsEl.classList.contains('hidden')) {
    settingsEl.classList.remove('hidden')
    uiRoot.classList.add('settings-open')
    settingsStackSide = null
    uiRoot.classList.add('settings-positioning')
    void renderSettings().then(() => {
      if (settingsEl.classList.contains('hidden')) return
      uiRoot.classList.remove('settings-positioning')
      if (lastCursorPosition) placeStack(lastCursorPosition)
    })
  } else {
    closeSettingsPanel()
  }
  clearTimeout(settingsHideTimer)
  settingsHideTimer = null
})

// The main process polls the global cursor, so this also works once the mouse has left the window
const NEAR_PX = 120
const SETTINGS_MARGIN = 16
const inside = (r, x, y, m = 0) => x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m
let petHoveredOnce = false
let settingsStackSide = null
let lastCursorPosition = null
let lastPointerPosition = null
let settingsPointerDown = false
let settingsHideTimer = null
const SETTINGS_HIDE_DELAY_MS = 800

function onPointer({ x, y }) {
  lastPointerPosition = { x, y }
  const pet = petEl.getBoundingClientRect()
  const overPet = hitTestPet(x, y)
  if (overPet) petHoveredOnce = true
  const dx = Math.max(pet.left - x, 0, x - pet.right)
  const dy = Math.max(pet.top - y, 0, y - pet.bottom)
  const nearPet = petHoveredOnce ? Math.hypot(dx, dy) < NEAR_PX * inputScale : overPet
  const near = nearPet || inside(form.getBoundingClientRect(), x, y)
  const overInteractive = overPet || [form, bubble, settingsEl, confirmBox].some((element) =>
    !element.classList.contains('hidden') && !(element === form && form.classList.contains('away')) && inside(element.getBoundingClientRect(), x, y)
  ) || (settingsStackSide === 'below' && !settingsEl.classList.contains('hidden') && inside(stack.getBoundingClientRect(), x, y))
  setMouseIgnored(!overInteractive && !settingsPointerDown)
  // Hide on pointer leave even if the input still has focus or contains a draft.
  if (near) form.classList.remove('away')
  else {
    form.classList.add('away')
    if (document.activeElement === input) input.blur()
  }

  // The settings panel hides once the mouse is away from both the pet and the panel
  if (!settingsEl.classList.contains('hidden')) {
    const panel = settingsEl.getBoundingClientRect()
    const zone = {
      left: Math.min(pet.left, panel.left),
      top: Math.min(pet.top, panel.top),
      right: Math.max(pet.right, panel.right),
      bottom: Math.max(pet.bottom, panel.bottom)
    }
    if (settingsPointerDown || inside(zone, x, y, SETTINGS_MARGIN * inputScale)) {
      clearTimeout(settingsHideTimer)
      settingsHideTimer = null
    } else if (settingsHideTimer === null) {
      settingsHideTimer = setTimeout(() => {
        settingsHideTimer = null
        if (settingsEl.classList.contains('hidden') || settingsPointerDown || !lastPointerPosition) return
        const currentPet = petEl.getBoundingClientRect()
        const currentPanel = settingsEl.getBoundingClientRect()
        const currentZone = {
          left: Math.min(currentPet.left, currentPanel.left),
          top: Math.min(currentPet.top, currentPanel.top),
          right: Math.max(currentPet.right, currentPanel.right),
          bottom: Math.max(currentPet.bottom, currentPanel.bottom)
        }
        if (!inside(currentZone, lastPointerPosition.x, lastPointerPosition.y, SETTINGS_MARGIN * inputScale)) {
          closeSettingsPanel()
        }
      }, SETTINGS_HIDE_DELAY_MS)
    }
  }
}

stack.addEventListener('mousedown', () => {
  if (!settingsEl.classList.contains('hidden')) settingsPointerDown = true
})
document.addEventListener('mouseup', (event) => {
  if (!settingsPointerDown) return
  settingsPointerDown = false
  onPointer({ x: event.clientX, y: event.clientY })
})

// Polled global cursor (works outside the window); mousemove covers the case where polling is unavailable
// Keep the stack on screen: flip it below the pet when there is no room above, and nudge it sideways at screen edges
function placeStack({ bounds, work }) {
  lastCursorPosition = { bounds, work }
  const settingsOpen = !settingsEl.classList.contains('hidden')
  if (settingsOpen && uiRoot.classList.contains('settings-positioning')) return
  const height = settingsOpen && settingsEl.scrollHeight
    ? settingsEl.scrollHeight * inputScale
    : stack.getBoundingClientRect().height
  if (!height) return
  const gap = 12 * inputScale
  const freeAbove = bounds.y + petEl.getBoundingClientRect().top - work.y
  const freeBelow = work.y + work.height - (bounds.y + form.getBoundingClientRect().bottom)
  if (settingsOpen) {
    if (settingsStackSide === null && settingsEl.childElementCount > 0) {
      settingsStackSide = freeAbove < height + gap && freeBelow > freeAbove ? 'below' : 'above'
    }
    if (settingsStackSide !== null) stack.classList.toggle('below', settingsStackSide === 'below')
  } else {
    stack.classList.toggle('below', freeAbove < height + gap && freeBelow > freeAbove)
  }
  const rect = stack.getBoundingClientRect()
  const margin = 8 * inputScale
  const viewportWidth = document.documentElement.clientWidth
  const currentShift = Number.parseFloat(stack.style.getPropertyValue('--shift')) || 0
  const baseLeft = rect.left - currentShift * inputScale
  const baseRight = rect.right - currentShift * inputScale
  let shift = 0
  if (baseLeft < margin) shift = margin - baseLeft
  else if (baseRight > viewportWidth - margin) shift = viewportWidth - margin - baseRight
  stack.style.setProperty('--shift', `${shift / inputScale}px`)
}

window.pet.onCursor?.((p) => {
  onPointer(p)
  placeStack(p)
})
document.addEventListener('mousemove', (e) => onPointer({ x: e.clientX, y: e.clientY }))

form.addEventListener('submit', (e) => {
  e.preventDefault()
  if (busy) return
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  ask(text, 'text')
})
