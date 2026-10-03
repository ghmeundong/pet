import { execFile } from 'child_process'

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public class W{
[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int p);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
}
"@
$h=[W]::GetForegroundWindow()
$id=0
[void][W]::GetWindowThreadProcessId($h,[ref]$id)
$sb=New-Object Text.StringBuilder 512
[void][W]::GetWindowText($h,$sb,512)
$p=Get-Process -Id $id -ErrorAction SilentlyContinue
@{app=$p.ProcessName;title=$sb.ToString()} | ConvertTo-Json -Compress
`
const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64')

export function readActiveWindow() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null)
        try {
          resolve(JSON.parse(stdout.trim()))
        } catch {
          resolve(null)
        }
      }
    )
  })
}

const SELF = /^(electron|desktoppet)$/i

// 활성 창이 바뀌면 쿨다운을 지켜 콜백 호출
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
