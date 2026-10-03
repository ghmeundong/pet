import { exec, execFile, spawn } from 'child_process'
import { readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { resolve } from 'path'
import { readActiveWindow } from './watcher'
import { readScreenText } from './ocr'
import { getSettings } from './settings'
import { deleteNote, listNotes, setNote } from './notes'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILE_CHARS = 8000

const APP_ALIASES = { '메모장': 'notepad', '계산기': 'calculator', '그림판': 'paint', calc: 'calculator', mspaint: 'paint' }

// 기본 오디오 장치의 마스터 볼륨을 읽고 쓰는 Core Audio COM 래퍼
const AUDIO_SRC = `Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume Vol() {
    var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume v = null;
    var id = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref id, 23, 0, out v));
    return v;
  }
  public static float Get() { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void Set(float v) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty)); }
}
'@`

const SYSTEM_PANELS = {
  task_manager: 'taskmgr',
  control_panel: 'control',
  device_manager: 'devmgmt.msc',
  services: 'services.msc',
  disk_management: 'diskmgmt.msc',
  registry_editor: 'regedit',
  network_connections: 'ncpa.cpl',
  programs_and_features: 'appwiz.cpl',
  sound: 'mmsys.cpl',
  settings: 'ms-settings:',
  display: 'ms-settings:display',
  wifi: 'ms-settings:network-wifi',
  bluetooth: 'ms-settings:bluetooth',
  apps: 'ms-settings:appsfeatures',
  power: 'ms-settings:powersleep',
  windows_update: 'ms-settings:windowsupdate'
}

const TOOLS = {
  get_active_window: {
    label: '활성 창 확인',
    description: '사용자가 지금 보고 있는 앱 이름과 창 제목을 알려준다.',
    parameters: { type: 'object', properties: {} },
    run: async () => JSON.stringify(await readActiveWindow())
  },
  read_screen_text: {
    label: '화면 읽기',
    description: '현재 화면 전체를 OCR로 읽어 텍스트를 반환한다. 느리므로 꼭 필요할 때만 쓴다.',
    parameters: { type: 'object', properties: {} },
    run: async () => (await readScreenText(1500)) || '(읽힌 텍스트 없음)'
  },
  launch_app: {
    label: '앱 실행',
    description: '설치된 앱이나 프로그램을 이름 또는 경로로 실행한다. 예: notepad, calc, chrome, C:\\Windows\\notepad.exe',
    parameters: {
      type: 'object',
      properties: { app: { type: 'string', description: '실행할 앱 이름 또는 경로' } },
      required: ['app']
    },
    describe: (a) => `"${a.app}" 앱을 실행할까요?`,
    run: async ({ app: raw }) => {
      const key = String(raw ?? '').trim()
      const lower = key.toLowerCase().replace(/\.exe$/, '')
      const target = getSettings().allowedApps[APP_ALIASES[lower] ?? lower] ?? key
      // cmd 메타문자로 다른 명령이 붙는 것만 막는다
      if (!target || /[&|<>^%"\r\n]/.test(target)) return `실행할 수 없는 이름 "${raw}"`
      console.log(`[tool] launch ${target}`)
      const child = spawn('cmd', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', windowsHide: true })
      child.on('error', () => {})
      child.unref()
      return `${target} 실행 요청함`
    }
  },
  read_file: {
    label: '파일 읽기',
    description: '텍스트 파일 내용을 읽는다. 절대 경로 또는 홈 폴더 기준 상대 경로.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '파일 경로' } },
      required: ['path']
    },
    describe: (a) => `파일을 읽을까요?\n${a.path}`,
    run: async ({ path }) => {
      const file = resolve(homedir(), String(path))
      const info = await stat(file)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) return '읽을 수 없는 파일'
      return (await readFile(file, 'utf8')).slice(0, MAX_FILE_CHARS)
    }
  },
  set_brightness: {
    label: '화면 밝기 조절',
    description:
      '화면 밝기(0~100)를 조절한다. 절대값은 level, 상대 증감은 delta(예: 조금 낮추기 -10, 더 밝게 +20)로 지정한다. 노트북 내장 디스플레이만 지원.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'number', description: '목표 밝기 0~100' },
        delta: { type: 'number', description: '현재 밝기에 더할 값 (-100~100)' }
      }
    },
    run: ({ level, delta }) => {
      const abs = level != null && Number.isFinite(Number(level))
      const script =
        '$cur=(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness;' +
        (abs ? `$n=${Math.round(Number(level))};` : `$n=$cur+(${Math.round(Number(delta)) || 0});`) +
        '$n=[Math]::Max(0,[Math]::Min(100,$n));' +
        'Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=$n} | Out-Null;' +
        'Write-Output "밝기 $cur -> $n"'
      return new Promise((done) => {
        execFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 10000, windowsHide: true }, (err, out) =>
          done(err ? '밝기 조절 실패 (내장 디스플레이가 아니거나 지원되지 않음)' : out.trim())
        )
      })
    }
  },
  run_command: {
    label: '명령 실행',
    description:
      'Windows cmd 또는 PowerShell 명령을 실행하고 출력을 반환한다. 사용자가 cmd를 언급하지 않아도, 파일/폴더 조작, 시스템 정보(IP, 디스크, 프로세스 등), 레지스트리·서비스·시스템 설정 변경, 프로그램 종료·실행 등 명령줄로 해결되는 일이면 이 도구로 직접 시도한다. cmd로 안 되면 shell=powershell을 쓴다. 실패하면 명령을 고쳐 다시 시도한다. 사용자가 진행 과정을 직접 보고 싶어하거나 오래 걸리는 작업이면 visible=true.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '실행할 명령' },
        shell: { type: 'string', enum: ['cmd', 'powershell'], description: '기본 cmd' },
        visible: { type: 'boolean', description: 'true면 새 창을 띄워 실행' }
      },
      required: ['command']
    },
    describe: (a) => `명령을 실행할까요?\n${a.command}`,
    run: ({ command, shell, visible }) => {
      const cmd = String(command ?? '').trim()
      if (!cmd) return Promise.resolve('빈 명령')
      const ps = shell === 'powershell'
      console.log(`[tool] ${ps ? 'powershell' : 'cmd'}${visible ? ' (visible)' : ''}> ${cmd}`)
      if (visible) {
        const args = ps ? ['/c', 'start', 'powershell', '-NoExit', '-Command', cmd] : ['/c', 'start', 'cmd', '/k', cmd]
        const child = spawn('cmd', args, { detached: true, stdio: 'ignore' })
        child.on('error', () => {})
        child.unref()
        return Promise.resolve('새 창에서 실행 요청함')
      }
      return new Promise((done) => {
        const finish = (err, stdout, stderr) => {
          const out = `${stdout}${stderr}`.trim().slice(0, MAX_FILE_CHARS)
          done(err?.killed ? `시간 초과(30초)\n${out}` : out || (err ? `실패: ${err.message}` : '(출력 없음)'))
        }
        const opts = { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true }
        if (ps) {
          // PowerShell 출력을 UTF-8로 받는다
          execFile('powershell.exe', ['-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${cmd}`], opts, finish)
        } else {
          // chcp 65001로 cmd 출력을 UTF-8로 받는다
          exec(`chcp 65001>nul && ${cmd}`, opts, finish)
        }
      })
    }
  },
  open_system_panel: {
    label: '시스템 창 열기',
    description: `작업 관리자, 제어판, Windows 설정 등 시스템 화면을 연다. target: ${Object.keys(SYSTEM_PANELS).join(', ')} 또는 'ms-settings:화면이름'(예: ms-settings:privacy)`,
    parameters: {
      type: 'object',
      properties: { target: { type: 'string', description: '열 화면 이름' } },
      required: ['target']
    },
    run: ({ target }) => {
      const key = String(target ?? '').trim()
      const cmd = SYSTEM_PANELS[key] ?? (/^ms-settings:[a-z0-9-]*$/i.test(key) ? key : null)
      if (!cmd) return `알 수 없는 화면 "${key}". 가능: ${Object.keys(SYSTEM_PANELS).join(', ')}`
      console.log(`[tool] open ${cmd}`)
      const child = spawn('cmd', ['/c', 'start', '""', cmd], { detached: true, stdio: 'ignore', windowsHide: true })
      child.on('error', () => {})
      child.unref()
      return `${key} 열기 요청함`
    }
  },
  open_url: {
    label: '웹페이지 열기',
    description:
      '기본 브라우저로 웹 주소(http/https)를 연다. 예: Gmail=https://mail.google.com. 열어서 내용을 확인해야 하면 wait_seconds를 주고, 이후 read_screen_text로 화면을 읽는다.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http 또는 https 주소' },
        wait_seconds: { type: 'number', description: '로딩 대기 시간(0~15초)' }
      },
      required: ['url']
    },
    run: async ({ url, wait_seconds }) => {
      const target = String(url ?? '').trim()
      if (!/^https?:\/\/[^\s&|<>^"%]+$/i.test(target)) return `열 수 없는 주소 "${url}"`
      console.log(`[tool] open_url ${target}`)
      const child = spawn('cmd', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', windowsHide: true })
      child.on('error', () => {})
      child.unref()
      const wait = Math.min(Math.max(Number(wait_seconds) || 0, 0), 15)
      if (wait) await new Promise((r) => setTimeout(r, wait * 1000))
      return `${target} 열었음`
    }
  },
  volume: {
    label: '볼륨 조절',
    description:
      '시스템 볼륨(0~100)을 조회하거나 조절한다. 인자 없이 호출하면 현재 볼륨만 반환한다. 절대값은 level, 상대 증감은 delta.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'number', description: '목표 볼륨 0~100' },
        delta: { type: 'number', description: '현재 볼륨에 더할 값' }
      }
    },
    run: ({ level, delta }) => {
      const abs = level != null && Number.isFinite(Number(level))
      const rel = delta != null && Number.isFinite(Number(delta))
      const change = abs
        ? `$n=${Math.round(Number(level))}`
        : rel
          ? `$n=$cur+(${Math.round(Number(delta))})`
          : ''
      const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8\n${AUDIO_SRC}\n$cur=[Math]::Round([Audio]::Get()*100)\n` +
        (change
          ? `${change}\n$n=[Math]::Max(0,[Math]::Min(100,$n))\n[Audio]::Set($n/100)\nWrite-Output "볼륨 $cur -> $n"`
          : 'Write-Output "현재 볼륨 $cur"')
      return new Promise((done) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
          { timeout: 15000, windowsHide: true },
          (err, out) => done(err ? `볼륨 조작 실패: ${err.message.slice(0, 200)}` : out.trim())
        )
      })
    }
  },
  memory: {
    label: '기억 저장/조회',
    description:
      '사용자가 기억해 달라고 한 값을 디스크에 저장하고 나중에 꺼낸다. action: save(저장), get(한 항목 조회), list(전체), delete(삭제). 예: 현재 볼륨을 기억해달라고 하면 volume으로 현재 값을 조회한 뒤 key=volume, value=그 숫자로 save.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'get', 'list', 'delete'] },
        key: { type: 'string', description: '이름 (예: volume, brightness, 좋아하는_음식)' },
        value: { type: 'string', description: 'save일 때 저장할 값' }
      },
      required: ['action']
    },
    run: ({ action, key, value }) => {
      const k = String(key ?? '').trim()
      const notes = listNotes()
      if (action === 'list') return JSON.stringify(Object.fromEntries(Object.entries(notes).map(([n, v]) => [n, v.value])))
      if (!k) return 'key가 필요함'
      if (action === 'get') return notes[k] ? `${k}=${notes[k].value} (${notes[k].savedAt})` : '저장된 기억 없음'
      if (action === 'delete') return deleteNote(k) ? `${k} 삭제함` : '저장된 기억 없음'
      if (action === 'save') {
        if (value == null || String(value).trim() === '') return 'value가 필요함'
        return setNote(k, String(value)) ? `${k}=${value} 저장함` : '기억 저장 한도 초과'
      }
      return 'action은 save/get/list/delete 중 하나'
    }
  }
}

export function getToolSpecs() {
  const enabled = getSettings().tools
  return Object.entries(TOOLS)
    .filter(([name]) => enabled[name])
    .map(([name, t]) => ({ name, description: t.description, parameters: t.parameters }))
}

// ctx: { confirm(message) => Promise<boolean>, onTool(label) }
export async function runTool(name, args, ctx) {
  const tool = TOOLS[name]
  if (!tool || !getSettings().tools[name]) {
    console.warn(`[tool] ${name} 사용 불가 (미정의 또는 권한 off)`)
    return '사용할 수 없는 도구'
  }
  args = args && typeof args === 'object' ? args : {}
  if (tool.confirm && !(await ctx.confirm(tool.describe(args)))) return '사용자가 거부함'
  ctx.onTool(tool.label)
  try {
    return String(await tool.run(args))
  } catch (e) {
    return `실패: ${e.message}`
  }
}
