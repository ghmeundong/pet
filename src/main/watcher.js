import { execFile } from 'child_process'

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public class W{
[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int p);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll")]public static extern IntPtr GetWindow(IntPtr h,uint c);
[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
}
"@
function Info($h){
  $id=0
  [void][W]::GetWindowThreadProcessId($h,[ref]$id)
  $sb=New-Object Text.StringBuilder 512
  [void][W]::GetWindowText($h,$sb,512)
  $p=Get-Process -Id $id -ErrorAction SilentlyContinue
  @{app=$p.ProcessName;title=$sb.ToString()}
}
$h=[W]::GetForegroundWindow()
$r=Info $h
$n=0
# If the pet window has focus, find the real window below it in Z-order
while($r.app -match '^(electron|DesktopPet)$' -and $n -lt 60){
  $h=[W]::GetWindow($h,2)
  if($h -eq [IntPtr]::Zero){break}
  if([W]::IsWindowVisible($h)){
    $c=Info $h
    if($c.title -and $c.app -notmatch '^(electron|DesktopPet|TextInputHost|SearchHost)$'){ $r=$c; break }
  }
  $n++
}
$r | ConvertTo-Json -Compress
`
const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64')
const IGNORED_WINDOW = /click[\s._-]*todo/i

export function readActiveWindow() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null)
        try {
          const windowInfo = JSON.parse(stdout.trim())
          resolve(IGNORED_WINDOW.test(`${windowInfo.app ?? ''} ${windowInfo.title ?? ''}`) ? null : windowInfo)
        } catch {
          resolve(null)
        }
      }
    )
  })
}

const SELF = /^(electron|desktoppet)$/i

// Call back when the active window changes, respecting the cooldown
export function watchActiveWindow(onChange, { intervalMs = 5000, cooldownMs = 30000 } = {}) {
  let lastKey = ''
  let lastFired = 0
  const timer = setInterval(async () => {
    const w = await readActiveWindow()
    if (!w?.app || !w.title || SELF.test(w.app)) return
    const key = `${w.app}|${w.title}`
    if (key === lastKey || Date.now() - lastFired < cooldownMs) return
    lastKey = key
    lastFired = Date.now()
    onChange(w)
  }, intervalMs)
  return () => clearInterval(timer)
}
