import { execFile } from 'child_process'

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SelectionInput {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION data; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool GetTokenInformation(IntPtr token, int infoClass, out TOKEN_ELEVATION info, uint size, out uint returned);
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_ELEVATION { public int TokenIsElevated; }
  public static int IsElevated(int processId) {
    IntPtr process = OpenProcess(0x1000, false, processId);
    if (process == IntPtr.Zero) return -1;
    try {
      IntPtr token;
      if (!OpenProcessToken(process, 0x0008, out token)) return -1;
      try {
        TOKEN_ELEVATION info; uint returned;
        if (!GetTokenInformation(token, 20, out info, (uint)Marshal.SizeOf(typeof(TOKEN_ELEVATION)), out returned)) return -1;
        return info.TokenIsElevated != 0 ? 1 : 0;
      } finally { CloseHandle(token); }
    } finally { CloseHandle(process); }
  }
  public static uint Copy() {
    INPUT[] inputs = new INPUT[4];
    ushort[] keys = new ushort[] { 0x11, 0x43, 0x43, 0x11 };
    uint[] flags = new uint[] { 0, 0, 2, 2 };
    for (int i = 0; i < inputs.Length; i++) {
      inputs[i].type = 1; inputs[i].data.ki.wVk = keys[i]; inputs[i].data.ki.dwFlags = flags[i];
    }
    return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
function GetSelectionInfo($element) {
  try {
    $textPattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
      $ranges = $textPattern.GetSelection()
      if ($ranges.Length -gt 0) {
        $text = (($ranges | ForEach-Object { $_.GetText(4000) }) -join "\`n").Trim()
        $rectangles = @($ranges | ForEach-Object { $_.GetBoundingRectangles() } | ForEach-Object { $_ })
        $anchor = $null
        if ($rectangles.Length -ge 4) {
          $left = [double]::PositiveInfinity
          $top = [double]::PositiveInfinity
          $right = [double]::NegativeInfinity
          $bottom = [double]::NegativeInfinity
          for ($i = 0; $i + 3 -lt $rectangles.Length; $i += 4) {
            $left = [Math]::Min($left, $rectangles[$i])
            $top = [Math]::Min($top, $rectangles[$i + 1])
            $right = [Math]::Max($right, $rectangles[$i] + $rectangles[$i + 2])
            $bottom = [Math]::Max($bottom, $rectangles[$i + 1] + $rectangles[$i + 3])
          }
          $anchor = @{ x = ($left + $right) / 2; y = ($top + $bottom) / 2 }
        }
        return @{ text = $text; anchor = $anchor }
      }
    }
  } catch {}
  return @{ text = ''; anchor = $null }
}
function GetEditableElement($element) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $current = $element
  for ($depth = 0; $current -and $depth -lt 12; $depth++) {
    try {
      if ($current.Current.IsEnabled -and $current.Current.IsKeyboardFocusable) {
        $valuePattern = $null
        if ($current.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and -not $valuePattern.Current.IsReadOnly) {
          return $current
        }
        $textPattern = $null
        if ($current.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
          $readOnly = $textPattern.DocumentRange.GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute)
          if ($readOnly -is [bool] -and -not $readOnly) { return $current }
        }
      }
      $current = $walker.GetParent($current)
    } catch { break }
  }
  return $null
}
function FindSelectionInWindow($root, $processId) {
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($root)
  $visited = 0
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  while ($queue.Count -gt 0 -and $visited -lt 300) {
    $element = $queue.Dequeue()
    $visited++
    try {
      if ($element.Current.ProcessId -eq $processId) {
        $info = GetSelectionInfo $element
        if (-not [string]::IsNullOrWhiteSpace($info.text)) { return $info }
        $child = $walker.GetFirstChild($element)
        while ($child) {
          $queue.Enqueue($child)
          $child = $walker.GetNextSibling($child)
        }
      }
    } catch {}
  }
  return ''
}
$target = [SelectionInput]::GetForegroundWindow()
if ($target -eq [IntPtr]::Zero) { @{ self = $true } | ConvertTo-Json -Compress; exit }
$processId = 0
[void][SelectionInput]::GetWindowThreadProcessId($target, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if ($process -and $process.ProcessName -match '^(electron|desktop\s*pet)$') {
  @{ self = $true } | ConvertTo-Json -Compress
  exit
}
$targetElevated = [SelectionInput]::IsElevated($processId)
$callerElevated = [SelectionInput]::IsElevated($PID)
Start-Sleep -Milliseconds 160
$editable = $false
$runtimeId = @()
$selectedText = ''
$selectionAnchor = $null
$copySent = -1
try {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($focused) {
    $selectionInfo = GetSelectionInfo $focused
    $selectedText = $selectionInfo.text
    $selectionAnchor = $selectionInfo.anchor
    if ([string]::IsNullOrWhiteSpace($selectedText)) {
      $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
      $ancestor = $walker.GetParent($focused)
      for ($depth = 0; $ancestor -and $depth -lt 12 -and [string]::IsNullOrWhiteSpace($selectedText); $depth++) {
        $selectionInfo = GetSelectionInfo $ancestor
        $selectedText = $selectionInfo.text
        if ($selectionInfo.anchor) { $selectionAnchor = $selectionInfo.anchor }
        $ancestor = $walker.GetParent($ancestor)
      }
    }
    $editableElement = GetEditableElement $focused
    if ($editableElement) {
      $editable = $true
      $runtimeId = $editableElement.GetRuntimeId()
    }
  }
} catch {}
if ([string]::IsNullOrWhiteSpace($selectedText)) {
  try {
    $selectionInfo = FindSelectionInWindow ([System.Windows.Automation.AutomationElement]::FromHandle($target)) $processId
    $selectedText = $selectionInfo.text
    $selectionAnchor = $selectionInfo.anchor
  } catch {}
}
if ([string]::IsNullOrWhiteSpace($selectedText)) {
  Start-Sleep -Milliseconds 160
  $copySent = [SelectionInput]::Copy()
  Start-Sleep -Milliseconds 250
}
@{ target = $target.ToInt64(); editable = $editable; runtimeId = $runtimeId; text = $selectedText; anchor = $selectionAnchor; copySent = $copySent; targetElevated = $targetElevated; callerElevated = $callerElevated } | ConvertTo-Json -Compress
`

const PASTE_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SelectionPaste {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION data; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static uint Paste() {
    INPUT[] inputs = new INPUT[4];
    ushort[] keys = new ushort[] { 0x11, 0x56, 0x56, 0x11 };
    uint[] flags = new uint[] { 0, 0, 2, 2 };
    for (int i = 0; i < inputs.Length; i++) {
      inputs[i].type = 1; inputs[i].data.ki.wVk = keys[i]; inputs[i].data.ki.dwFlags = flags[i];
    }
    return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
$target = [IntPtr]::new([Int64]$env:PET_TARGET_WINDOW)
if (-not [SelectionPaste]::SetForegroundWindow($target)) { Write-Output 'PASTE_STATUS: foreground_request_rejected'; exit 2 }
Start-Sleep -Milliseconds 120
if ([SelectionPaste]::GetForegroundWindow() -ne $target) { Write-Output 'PASTE_STATUS: target_not_foreground'; exit 2 }
try {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $expectedRuntimeId = @($env:PET_TARGET_RUNTIME_ID -split ',') | ForEach-Object { [int]$_ }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $current = $focused
  $matched = $false
  for ($depth = 0; $current -and $depth -lt 12; $depth++) {
    if (($expectedRuntimeId -join ',') -eq ($current.GetRuntimeId() -join ',')) {
      $valuePattern = $null
      if ($current.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and -not $valuePattern.Current.IsReadOnly) {
        $matched = $true
      } else {
        $textPattern = $null
        if ($current.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
          $readOnly = $textPattern.DocumentRange.GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute)
          $matched = $readOnly -is [bool] -and -not $readOnly
        }
      }
      break
    }
    $current = $walker.GetParent($current)
  }
  if (-not $matched) { Write-Output 'PASTE_STATUS: edit_target_changed'; exit 3 }
} catch { Write-Output 'PASTE_STATUS: edit_target_check_failed'; exit 3 }
$sent = [SelectionPaste]::Paste()
if ($sent -ne 4) { Write-Output "PASTE_STATUS: SendInput accepted $sent of 4"; exit 4 }
Start-Sleep -Milliseconds 500
$verified = $false
try {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $current = $focused
  for ($depth = 0; $current -and $depth -lt 12; $depth++) {
    if (($expectedRuntimeId -join ',') -eq ($current.GetRuntimeId() -join ',')) {
      $valuePattern = $null
      if ($current.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
        $verified = $valuePattern.Current.Value.Contains($env:PET_EXPECTED_TEXT)
      } else {
        $textPattern = $null
        if ($current.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
          $range = $textPattern.DocumentRange.FindText($env:PET_EXPECTED_TEXT, $false, $false)
          $verified = $null -ne $range
        }
      }
      break
    }
    $current = $walker.GetParent($current)
  }
} catch {}
if (-not $verified) { Write-Output 'PASTE_STATUS: text_change_not_verified'; exit 5 }
Write-Output 'INSERTED'
`

function runPowerShell(script, env = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      env: { ...process.env, ...env }
    }, (error, stdout) => {
      if (error) {
        error.stdout = stdout
        reject(error)
      } else resolve(stdout.trim())
    })
  })
}

export async function captureSelectedText(clipboard) {
  if (process.platform !== 'win32') return null
  const previousFormats = clipboard.availableFormats().map((format) => ({ format, data: clipboard.readBuffer(format) }))
  const marker = `desktop-pet-selection-${Date.now()}-${Math.random()}`
  try {
    clipboard.writeText(marker)
    const metadata = JSON.parse(await runPowerShell(SCRIPT))
    if (metadata.self) return null
    const text = String(metadata.text || clipboard.readText()).trim()
    if (text && text !== marker) {
      return {
        text,
        target: metadata.target,
        editable: metadata.editable === true,
        runtimeId: metadata.runtimeId,
        anchor: metadata.anchor,
        source: metadata.text ? 'uia' : 'clipboard',
        targetElevated: metadata.targetElevated,
        callerElevated: metadata.callerElevated
      }
    }
    console.warn(`[selection] copy fallback returned no text; SendInput accepted ${metadata.copySent}/4 events; target elevated=${metadata.targetElevated}, app elevated=${metadata.callerElevated}`)
    return null
  } catch (error) {
    console.warn('[selection] could not capture selected text:', error.message)
    return null
  } finally {
    clipboard.clear()
    for (const { format, data } of previousFormats) {
      try { clipboard.writeBuffer(format, data) } catch {}
    }
  }
}

export async function insertTextAtTarget(clipboard, target, runtimeId, text) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(target) || !Array.isArray(runtimeId) || !runtimeId.length || typeof text !== 'string' || !text) return false
  const previousFormats = clipboard.availableFormats().map((format) => ({ format, data: clipboard.readBuffer(format) }))
  try {
    clipboard.writeText(text)
    const result = await runPowerShell(PASTE_SCRIPT, {
      PET_TARGET_WINDOW: String(target),
      PET_TARGET_RUNTIME_ID: runtimeId.join(','),
      PET_EXPECTED_TEXT: text
    })
    return result.split(/\r?\n/).includes('INSERTED')
  } catch (error) {
    console.warn(`[selection] could not insert answer (code ${error.code}):`, error.message, error.stdout?.trim())
    return false
  } finally {
    clipboard.clear()
    for (const { format, data } of previousFormats) {
      try { clipboard.writeBuffer(format, data) } catch {}
    }
  }
}
