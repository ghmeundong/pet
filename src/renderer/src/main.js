const bubble = document.getElementById('bubble')
const petEl = document.getElementById('pet')
const form = document.getElementById('form')
const input = document.getElementById('input')
const confirmBox = document.getElementById('confirm')
const confirmMsg = document.getElementById('confirm-msg')
const settingsEl = document.getElementById('settings')

// 펫/말풍선/입력창 위에서만 마우스 입력을 받고, 빈 공간은 클릭 투과
document.querySelectorAll('.interactive').forEach((el) => {
  el.addEventListener('mouseenter', () => window.pet.setIgnoreMouse(false))
  el.addEventListener('mouseleave', () => window.pet.setIgnoreMouse(true))
})

let hideTimer
let busy = false
let statusShown = false

function ask(text, kind) {
  if (busy) return
  busy = true
  statusShown = false
  clearTimeout(hideTimer)
  bubble.textContent = ''
  bubble.classList.remove('hidden')
  petEl.classList.add('bounce')
  setTimeout(() => petEl.classList.remove('bounce'), 400)

  const finish = () => {
    busy = false
    hideTimer = setTimeout(() => bubble.classList.add('hidden'), 8000)
  }
  window.pet.chat(text, kind, {
    onChunk: (c) => {
      if (statusShown) {
        bubble.textContent = ''
        statusShown = false
      }
      bubble.textContent += c
      bubble.scrollTop = bubble.scrollHeight
    },
    onTool: (label) => {
      if (!bubble.textContent || statusShown) {
        bubble.textContent = `${label} 중...`
        statusShown = true
      }
    },
    onDone: finish,
    onReset: () => {
      bubble.textContent = ''
      statusShown = false
    },
    onError: (m) => {
      bubble.textContent = `앗, 오류가 났어... (${m})`
      finish()
    }
  })
}

petEl.addEventListener('click', () => ask('(사용자가 너를 클릭했다. 짧게 반응해줘)', 'click'))
// 활성 창이 바뀌면 펫이 먼저 말을 건다 (입력 중이거나 응답 중이면 생략)
window.pet.onActiveWindow(({ app, title }) => {
  if (busy || document.activeElement === input) return
  ask(`(사용자가 지금 "${app}" 앱에서 "${title}" 창을 보고 있다. 이에 맞춰 짧게 말을 걸어줘)`, 'auto')
})

// 위험한 도구는 실행 전에 사용자 확인을 받는다
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
  get_active_window: '활성 창 확인',
  read_screen_text: '화면 읽기(OCR)',
  launch_app: '앱 실행',
  read_file: '파일 읽기',
  run_command: 'cmd/PowerShell 명령 실행',
  open_system_panel: '작업관리자·제어판·설정 열기',
  volume: '볼륨 조절',
  open_url: '웹페이지 열기',
  memory: '기억 저장(디스크)',
  set_brightness: '화면 밝기 조절'
}

async function renderSettings() {
  const tools = await window.pet.getSettings()
  settingsEl.replaceChildren(
    ...Object.entries(TOOL_LABELS).map(([key, label]) => {
      const row = document.createElement('label')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = tools[key]
      box.onchange = () => window.pet.setSettings({ [key]: box.checked })
      row.append(box, ` ${label}`)
      return row
    })
  )
}

document.getElementById('gear').addEventListener('click', () => {
  settingsEl.classList.toggle('hidden')
  if (!settingsEl.classList.contains('hidden')) renderSettings()
})

petEl.addEventListener('contextmenu', () => window.pet.quit())

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  ask(text, 'text')
})
