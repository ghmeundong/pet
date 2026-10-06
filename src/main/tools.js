import { execFile, spawn } from 'child_process'
import { readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { resolve } from 'path'
import { readActiveWindow } from './watcher'
import { readScreenText } from './ocr'
import { getSettings } from './settings'
import { deleteNote, listNotes, setNote } from './notes'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILE_CHARS = 8000
const APP_LAUNCH_COMMAND = /(?:^|[&|;]\s*)(?:start(?:\.exe)?\b|start-process\b|invoke-item\b)|\bcmd(?:\.exe)?\s+\/c\s+start\b|\bexplorer(?:\.exe)?\s+shell:AppsFolder\b|\bstart-process\b/i

// Installed-app catalog: Start menu apps, App Paths registry, shortcuts and system executables
let catalog
let catalogLoadedAt = 0

const CATALOG_SCRIPT = `
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$items=New-Object System.Collections.ArrayList
Get-StartApps | ForEach-Object { [void]$items.Add(@{n=$_.Name;t=$_.AppID;k='start'}) }
foreach($root in 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths'){
  Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
    $p=(Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).'(default)'
    if($p){ [void]$items.Add(@{n=($_.PSChildName -replace '\\.exe$','');t=$p.Trim('"');k='exe'}) }
  }
}
$dirs=@("$env:ProgramData\\Microsoft\\Windows\\Start Menu","$env:APPDATA\\Microsoft\\Windows\\Start Menu","$env:USERPROFILE\\Desktop","$env:PUBLIC\\Desktop")
Get-ChildItem -Path $dirs -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { [void]$items.Add(@{n=$_.BaseName;t=$_.FullName;k='lnk'}) }
foreach($d in "$env:windir\\System32","$env:windir"){
  Get-ChildItem $d -Filter *.exe -ErrorAction SilentlyContinue | ForEach-Object { [void]$items.Add(@{n=$_.BaseName;t=$_.FullName;k='exe'}) }
}
$items | ConvertTo-Json -Compress
`

async function loadCatalog(force) {
  // A forced refresh is throttled so repeated misses do not rescan every time
  if (catalog && (!force || Date.now() - catalogLoadedAt < 60000)) return catalog
  catalog = await new Promise((done) =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-EncodedCommand', Buffer.from(CATALOG_SCRIPT, 'utf16le').toString('base64')],
      { timeout: 60000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, out) => {
        try {
          const list = JSON.parse(out)
          done(Array.isArray(list) ? list : [list])
        } catch {
          done(catalog ?? [])
        }
      }
    )
  )
  catalogLoadedAt = Date.now()
  return catalog
}

export const warmUpAppCatalog = () => loadCatalog().catch(() => {})

// Lowercase, drop version numbers like 0.0.0, keep letters/digits
const clean = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\bv?\d+(\.\d+)+\b/g, ' ')
    .replace(/[^a-z0-9\u3131-\uD79D]+/g, ' ')
    .trim()
const squash = (s) => clean(s).replace(/ /g, '')

function bigrams(s) {
  const grams = new Map()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  return grams
}

// Dice coefficient on character bigrams: tolerant of typos and missing words
function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const ga = bigrams(a)
  const gb = bigrams(b)
  let hits = 0
  for (const [g, c] of ga) hits += Math.min(c, gb.get(g) ?? 0)
  return (2 * hits) / (a.length - 1 + b.length - 1)
}

function score(query, name) {
  const q = squash(query)
  const n = squash(name)
  if (!q || !n) return 0
  if (q === n) return 100
  if (n.startsWith(q)) return 92 - Math.min(10, (n.length - q.length) / 2)
  if (n.includes(q)) return 78
  if (q.includes(n) && n.length >= 4) return 72
  const tokens = clean(query).split(' ').filter(Boolean)
  if (tokens.length > 1 && tokens.every((t) => n.includes(t))) return 68
  const d = dice(q, n)
  return d >= 0.6 ? 40 + d * 25 : 0
}

const KIND_RANK = { start: 2, lnk: 1, exe: 0 }

// Best match plus nearby names to suggest when nothing is good enough
function pickApp(items, query) {
  const ranked = items
    .map((it) => ({ it, s: score(query, it.n) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || KIND_RANK[b.it.k] - KIND_RANK[a.it.k] || a.it.n.length - b.it.n.length)
  const q = squash(query)
  const suggestions = [
    ...new Set(
      items
        .map((it) => ({ n: it.n, d: dice(q, squash(it.n)) }))
        .filter((r) => r.d >= 0.3)
        .sort((a, b) => b.d - a.d)
        .map((r) => r.n)
    )
  ].slice(0, 5)
  return { best: ranked[0]?.it ?? null, suggestions }
}

// Core Audio COM wrapper that reads/writes the default device master volume
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
    label: 'Checking active window',
    description: 'Returns the app name and window title of the window the user is currently looking at.',
    parameters: { type: 'object', properties: {} },
    run: async () => JSON.stringify(await readActiveWindow())
  },
  read_screen_text: {
    label: 'Reading screen',
    description: 'Reads the whole screen with OCR and returns the text. Slow, so use only when really needed.',
    parameters: { type: 'object', properties: {} },
    run: async () => (await readScreenText(1500)) || '(no text recognized)'
  },
  launch_app: {
    label: 'Launching app',
    description: 'Launches an installed app or program by name or path. Use this as the only tool to start an app; do not start the same app again with a shell command. Use open_url for web addresses.',
    parameters: {
      type: 'object',
      properties: { app: { type: 'string', description: 'App name or path to launch' } },
      required: ['app']
    },
    describe: (a) => `Launch "${a.app}"?`,
    run: async ({ app: raw }) => {
      const key = String(raw ?? '').trim()
      const lower = key.toLowerCase().replace(/\.exe$/, '')
      const mapped = getSettings().allowedApps[lower]
      const isPath = /[\\/]/.test(key) || /\.(exe|lnk)$/i.test(key)
      const start = (target) => {
        // Only block cmd metacharacters that would chain another command
        if (!target || /[&|<>^%"\r\n]/.test(target)) return `Cannot launch "${raw}"`
        console.log(`[tool] launch ${target}`)
        const child = spawn('cmd', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', windowsHide: true })
        child.on('error', () => {})
        child.unref()
        return `${target} launch requested`
      }
      if (mapped) return start(mapped)
      if (isPath) return start(key)
      // With only a name, fuzzy-match it against everything installed (games/launchers included)
      let found = pickApp(await loadCatalog(), key)
      if (!found.best) found = pickApp(await loadCatalog(true), key)
      if (!found.best) {
        const hint = found.suggestions.length ? ` Did you mean: ${found.suggestions.join(', ')}? Retry with one of these exact names.` : ''
        return `Could not find "${raw}" among installed apps, so it was NOT launched.${hint}`
      }
      const hit = found.best
      console.log(`[tool] launch ${hit.n} (${hit.k}: ${hit.t})`)
      if (hit.k === 'start') {
        const child = spawn('explorer.exe', [`shell:AppsFolder\\${hit.t}`], { detached: true, stdio: 'ignore' })
        child.on('error', () => {})
        child.unref()
        return `${hit.n} launch requested`
      }
      start(hit.t)
      return `${hit.n} launch requested`
    }
  },
  read_file: {
    label: 'Reading file',
    description: 'Reads a text file. Absolute path, or path relative to the home folder.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path' } },
      required: ['path']
    },
    confirm: true,
    describe: (a) => `Read this file?\n${a.path}`,
    run: async ({ path }) => {
      const file = resolve(homedir(), String(path))
      const info = await stat(file)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) return 'Cannot read this file'
      return (await readFile(file, 'utf8')).slice(0, MAX_FILE_CHARS)
    }
  },
  set_brightness: {
    label: 'Adjusting brightness',
    description:
      'Sets screen brightness (0-100). Use level for an absolute value or delta for a relative change (e.g. slightly dimmer = -10, brighter = +20). Laptop built-in displays only.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Target brightness 0-100' },
        delta: { type: 'number', description: 'Value to add to the current brightness (-100 to 100)' }
      }
    },
    run: ({ level, delta }) => {
      const abs = level != null && Number.isFinite(Number(level))
      const script =
        '$cur=(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness;' +
        (abs ? `$n=${Math.round(Number(level))};` : `$n=$cur+(${Math.round(Number(delta)) || 0});`) +
        '$n=[Math]::Max(0,[Math]::Min(100,$n));' +
        'Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=$n} | Out-Null;' +
        'Write-Output "Brightness $cur -> $n"'
      return new Promise((done) => {
        execFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 10000, windowsHide: true }, (err, out) =>
          done(err ? 'Brightness change failed (not a built-in display or unsupported)' : out.trim())
        )
      })
    }
  },
  run_command: {
    label: 'Running command',
    description:
      'Runs a Windows cmd or PowerShell command and returns its output. Use it directly, even if the user does not mention cmd, for command-line tasks: file/folder operations, system info (IP, disk, processes), registry/service/system settings, or killing programs. Do not use it to open or start apps; use launch_app instead. If cmd fails use shell=powershell. If it fails, fix the command and retry. Use visible=true if the user wants to watch the process or the task is long.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The actual shell command text to run (never a tool name). May be empty only when visible is true, to just open a terminal window.' },
        shell: { type: 'string', enum: ['cmd', 'powershell'], description: 'Default cmd' },
        visible: { type: 'boolean', description: 'If true, run in a new visible window' }
      },
      required: ['command']
    },
    confirm: true,
    examples: [
      { request: 'what is my IP address', args: { command: "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } | ForEach-Object { '{0}: {1}' -f $_.InterfaceAlias,$_.IPAddress }", shell: 'powershell' } },
      { request: 'what is my public IP address', args: { command: 'Invoke-RestMethod https://api.ipify.org', shell: 'powershell' } },
      { request: 'what is my default gateway and DNS server', args: { command: 'Get-NetIPConfiguration | Select-Object InterfaceAlias,IPv4DefaultGateway,DNSServer', shell: 'powershell' } },
      { request: 'is my Wi-Fi connected', args: { command: 'Get-NetConnectionProfile | Select-Object Name,InterfaceAlias,IPv4Connectivity', shell: 'powershell' } },
      { request: 'what Windows version is this computer running', args: { command: 'Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber', shell: 'powershell' } },
      { request: 'show the 5 processes using the most memory', args: { command: 'Get-Process | Sort-Object WS -Descending | Select-Object -First 5 Name,WS', shell: 'powershell' } },
      { request: 'create a folder called test on the desktop', args: { command: 'mkdir "%USERPROFILE%\\Desktop\\test"', shell: 'cmd' } },
      { request: 'open a cmd window', args: { command: '', shell: 'cmd', visible: true } },
      { request: 'show free disk space on the C drive', args: { command: 'Get-PSDrive C | Select-Object Used,Free', shell: 'powershell' } },
      { request: 'list the files on my desktop', args: { command: 'dir "%USERPROFILE%\\Desktop"', shell: 'cmd' } },
      { request: 'kill all notepad processes', args: { command: 'taskkill /IM notepad.exe /F', shell: 'cmd' } },
      { request: 'open a powershell window and ping a host', args: { command: 'ping example.com', shell: 'powershell', visible: true } }
    ],
    describe: (a) => `Run this command?\n${a.command}`,
    run: ({ command, shell, visible }) => {
      const cmd = String(command ?? '').trim()
      const ps = shell === 'powershell'
      if (APP_LAUNCH_COMMAND.test(cmd)) return 'Cannot start apps with shell commands; use launch_app instead.'
      if (Object.hasOwn(TOOLS, cmd)) {
        return Promise.resolve(`Cannot run "${cmd}": that is a tool name, not a shell command. Provide the actual ${ps ? 'PowerShell' : 'cmd'} command.`)
      }
      if (!cmd && !visible) return Promise.resolve('Empty command')
      console.log(`[tool] ${ps ? 'powershell' : 'cmd'}${visible ? ' (visible)' : ''}> ${cmd}`)
      if (visible) {
        const args = ps
          ? ['/c', 'start', 'powershell', '-NoExit', ...(cmd ? ['-Command', cmd] : [])]
          : ['/c', 'start', 'cmd', ...(cmd ? ['/k', cmd] : [])]
        const child = spawn('cmd', args, { detached: true, stdio: 'ignore' })
        child.on('error', () => {})
        child.unref()
        return Promise.resolve('Launch requested in a new window')
      }
      return new Promise((done) => {
        const finish = (err, stdout, stderr) => {
          const stdoutText = String(stdout ?? '').trim()
          const stderrText = String(stderr ?? '').trim()
          const out = `${stdoutText}${stdoutText && stderrText ? '\n' : ''}${stderrText}`.slice(0, MAX_FILE_CHARS)
          const commandFailed = Boolean(err) || Boolean(stderrText)
          done(err?.killed ? `Failed: timed out (30s)\n${out}` : commandFailed ? `Failed: ${out || err.message}` : out || '(no output)')
        }
        const opts = { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: ps ? 'utf8' : 'buffer' }
        if (ps) {
          // Receive PowerShell output as UTF-8
          execFile('powershell.exe', ['-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${cmd}`], opts, finish)
        } else {
          execFile('cmd.exe', ['/d', '/u', '/s', '/c', cmd], opts, (err, stdout, stderr) => {
            finish(err, Buffer.isBuffer(stdout) ? stdout.toString('utf16le') : stdout, Buffer.isBuffer(stderr) ? stderr.toString('utf16le') : stderr)
          })
        }
      })
    }
  },
  open_system_panel: {
    label: 'Opening system screen',
    description: `Opens a system screen such as Task Manager, Control Panel or Windows Settings. target: ${Object.keys(SYSTEM_PANELS).join(', ')}, or 'ms-settings:name' (e.g. ms-settings:privacy)`,
    parameters: {
      type: 'object',
      properties: { target: { type: 'string', description: 'Screen to open' } },
      required: ['target']
    },
    confirm: true,
    describe: (a) => `Close "${a.target}"?`,
    run: ({ target }) => {
      const key = String(target ?? '').trim()
      const cmd = SYSTEM_PANELS[key] ?? (/^ms-settings:[a-z0-9-]*$/i.test(key) ? key : null)
      if (!cmd) return `Unknown screen "${key}". Available: ${Object.keys(SYSTEM_PANELS).join(', ')}`
      console.log(`[tool] open ${cmd}`)
      const child = spawn('cmd', ['/c', 'start', '""', cmd], { detached: true, stdio: 'ignore', windowsHide: true })
      child.on('error', () => {})
      child.unref()
      return `${key} open requested`
    }
  },
  close_app: {
    label: 'Closing app/tab',
    description: 'Closes a matching app process, window, or browser tab by its process name, window title, or website domain.',
    parameters: {
      type: 'object',
      properties: { target: { type: 'string', description: 'Name of what to close' } },
      required: ['target']
    },
    run: ({ target }) => {
      const raw = String(target ?? '').trim()
      const name = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0]
      if (!/^[\p{L}\p{N}._ -]+$/u.test(name)) return `Cannot close "${target}"`
      const processName = name.replace(/\.exe$/i, '').replace(/'/g, "''")
      const windowTitle = name.split('.')[0].replace(/'/g, "''")
      const script = `$p=Get-Process -Name '${processName}' -ErrorAction SilentlyContinue; if($p){$p | Stop-Process -Force; 'Process terminated'} else {$s=New-Object -ComObject WScript.Shell; if($s.AppActivate('${windowTitle}')){Start-Sleep -Milliseconds 400; $s.SendKeys('^w'); 'Matching tab or window closed'} else {'No such process or matching window found'}}`
      console.log(`[tool] close ${name}`)
      return new Promise((done) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-EncodedCommand', Buffer.from(`[Console]::OutputEncoding=[Text.Encoding]::UTF8\n${script}`, 'utf16le').toString('base64')],
          { timeout: 10000, windowsHide: true },
          (err, out) => done(err ? `Close failed: ${err.message.slice(0, 200)}` : out.trim())
        )
      })
    }
  },
  open_url: {
    label: 'Opening web page',
    description:
      'Opens an http or https address in the default browser. For web research, construct a search URL with the user query properly URL-encoded. To inspect the page, set wait_seconds and then use read_screen_text when enabled.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http or https address' },
        wait_seconds: { type: 'number', description: 'Load wait time (0-15 seconds)' }
      },
      required: ['url']
    },
    run: async ({ url, wait_seconds }) => {
      const target = String(url ?? '').trim()
      let parsed
      try {
        parsed = new URL(target)
      } catch {
        return `Cannot open "${url}"`
      }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return `Cannot open "${url}"`
      console.log(`[tool] open_url ${parsed.href}`)
      const child = spawn('cmd', ['/c', 'start', '""', parsed.href], { detached: true, stdio: 'ignore', windowsHide: true })
      child.on('error', () => {})
      child.unref()
      const wait = Math.min(Math.max(Number(wait_seconds) || 0, 0), 15)
      if (wait) await new Promise((r) => setTimeout(r, wait * 1000))
      return `${parsed.href} opened`
    }
  },
  volume: {
    label: 'Adjusting volume',
    description:
      'Reads or sets the system volume (0-100). Called with no arguments it only returns the current volume. Use level for an absolute value or delta for a relative change.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Target volume 0-100' },
        delta: { type: 'number', description: 'Value to add to the current volume' }
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
          ? `${change}\n$n=[Math]::Max(0,[Math]::Min(100,$n))\n[Audio]::Set($n/100)\nWrite-Output "Volume $cur -> $n"`
          : 'Write-Output "Current volume $cur"')
      return new Promise((done) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
          { timeout: 15000, windowsHide: true },
          (err, out) => done(err ? `Volume operation failed: ${err.message.slice(0, 200)}` : out.trim())
        )
      })
    }
  },
  memory: {
    label: 'Accessing memory',
    description:
      'Saves a value the user asked to remember to disk, and recalls it later. action: save, get (one key), list (all), delete. Example: if asked to remember the current volume, read it with the volume tool, then save with key=volume and value=that number.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'get', 'list', 'delete'] },
        key: { type: 'string', description: 'Name (e.g. volume, brightness, favorite_food)' },
        value: { type: 'string', description: 'Value to store when action is save' }
      },
      required: ['action']
    },
    run: ({ action, key, value }) => {
      const k = String(key ?? '').trim()
      const notes = listNotes()
      if (action === 'list') return JSON.stringify(Object.fromEntries(Object.entries(notes).map(([n, v]) => [n, v.value])))
      if (!k) return 'key is required'
      if (action === 'get') return notes[k] ? `${k}=${notes[k].value} (${notes[k].savedAt})` : 'No such memory saved'
      if (action === 'delete') return deleteNote(k) ? `${k} deleted` : 'No such memory saved'
      if (action === 'save') {
        if (value == null || String(value).trim() === '') return 'value is required'
        return setNote(k, String(value)) ? `${k}=${value} saved` : 'Memory limit reached'
      }
      return 'action must be one of save/get/list/delete'
    }
  }
}

export function getToolSpecs() {
  const enabled = getSettings().tools
  return Object.entries(TOOLS)
    .filter(([name]) => enabled[name])
    .map(([name, t]) => ({ name, description: t.description, parameters: t.parameters, examples: t.examples }))
}

export function validatePowerShellCommand(command) {
  const sourceBase64 = Buffer.from(String(command), 'utf8').toString('base64')
  const script = [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    `$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${sourceBase64}'))`,
    '$tokens=$null',
    '$parseErrors=$null',
    '[System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors) | Out-Null',
    'if($parseErrors.Count -gt 0){$parseErrors | ForEach-Object { Write-Output ("Line {0}: {1}" -f $_.Extent.StartLineNumber,$_.Message) }; exit 2}'
  ].join('\n')
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolveValidation, rejectValidation) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], {
      timeout: 10000,
      windowsHide: true,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) rejectValidation(new Error((stdout || stderr || error.message).trim()))
      else resolveValidation()
    })
  })
}

// ctx: { confirm(message) => Promise<boolean>, onTool(label) }
export async function runTool(name, args, ctx) {
  const tool = TOOLS[name]
  if (!tool || !getSettings().tools[name]) {
    console.warn(`[tool] ${name} unavailable (undefined or disabled)`)
    return 'Tool unavailable'
  }
  args = args && typeof args === 'object' ? args : {}
  if (tool.confirm && !(await ctx.confirm(tool.describe(args)))) return 'Denied by the user'
  ctx.onTool(tool.label)
  try {
    return String(await tool.run(args))
  } catch (e) {
    return `Failed: ${e.message}`
  }
}
