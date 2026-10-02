# Runs xEdit and handles its dialogs so scripts can run unattended:
#  - "Module Selection": confirms the preselected plugins (OK)
#  - save-changes dialog: confirms saving when -AutoSave is given
# Prints one line per event; optional -ShotDir saves window captures for debugging.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$ArgsB64 = '',   # base64 of a JSON array of xEdit arguments
  [string[]]$XArgs = @(),
  [int]$TimeoutSec = 2700,
  [switch]$AutoSave,
  [string]$ShotDir = ''
)

Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Drawing;
public static class XEditUi {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  public struct RECT { public int L, T, R, B; }
  public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static List<IntPtr> Windows(uint pid) { var o = new List<IntPtr>(); EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) o.Add(h); return true; }, IntPtr.Zero); return o; }
  public static List<string> Buttons(IntPtr w) { var o = new List<string>(); EnumChildWindows(w, (c, l) => { if (Cls(c).Contains("Button") && IsWindowVisible(c)) o.Add(Text(c).Replace("&", "")); return true; }, IntPtr.Zero); return o; }
  public static bool Click(IntPtr w, string button) { bool done = false; EnumChildWindows(w, (c, l) => { if (!done && Cls(c).Contains("Button") && IsWindowVisible(c) && IsWindowEnabled(c) && Text(c).Replace("&", "") == button) { SendMessage(c, 0x00F5, IntPtr.Zero, IntPtr.Zero); done = true; } return true; }, IntPtr.Zero); return done; }
  public static void Shot(IntPtr h, string file) { RECT r; GetWindowRect(h, out r); if (r.R - r.L < 2 || r.B - r.T < 2) return; var bmp = new Bitmap(r.R - r.L, r.B - r.T); using (var g = Graphics.FromImage(bmp)) { var hdc = g.GetHdc(); PrintWindow(h, hdc, 2); g.ReleaseHdc(hdc); } bmp.Save(file); }
}
'@

if ($ArgsB64) {
  $decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgsB64)) | ConvertFrom-Json
  $XArgs = [string[]]@($decoded | ForEach-Object { $_ })
}
$argLine = ($XArgs | ForEach-Object { '"' + ($_ -replace '\\$', '\\') + '"' }) -join ' '
Write-Output "EVENT args $argLine"
$p = Start-Process -FilePath $Exe -ArgumentList $argLine -WorkingDirectory (Split-Path $Exe) -PassThru
Write-Output "EVENT started pid=$($p.Id)"
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$seen = @{}
$shot = 0
while (-not $p.WaitForExit(1500)) {
  if ((Get-Date) -gt $deadline) { Write-Output 'EVENT timeout'; Stop-Process $p -Force; exit 2 }
  foreach ($w in [XEditUi]::Windows([uint32]$p.Id)) {
    $title = [XEditUi]::Text($w)
    $buttons = [XEditUi]::Buttons($w)
    $key = "$title|$($buttons -join ',')"
    if (-not $seen.ContainsKey($key)) { $seen[$key] = 1; Write-Output "EVENT window '$title' buttons=[$($buttons -join ', ')]" }
    if ($title -eq 'Module Selection' -and [XEditUi]::Click($w, 'OK')) { Write-Output 'EVENT confirmed module selection' }
    elseif ($title -match 'message from the developer' -and [XEditUi]::Click($w, 'Close')) { Write-Output 'EVENT closed developer message' }
    elseif ($AutoSave -and $title -match 'Save' -and $buttons -contains 'OK' -and [XEditUi]::Click($w, 'OK')) { Write-Output "EVENT confirmed save ('$title')" }
  }
  if ($ShotDir -and ($shot -lt 40)) {
    $i = 0
    foreach ($w in [XEditUi]::Windows([uint32]$p.Id)) { try { [XEditUi]::Shot($w, (Join-Path $ShotDir ("s{0:D2}_{1}.png" -f $shot, $i))) } catch {}; $i++ }
    $shot++
  }
}
Write-Output "EVENT exited code=$($p.ExitCode)"
