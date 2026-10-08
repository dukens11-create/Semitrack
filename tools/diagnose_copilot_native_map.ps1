param(
  [string]$Device = "R5CRC2ZHA7H",
  [string]$PackageName = "com.semitrax.app.migration.debug2",
  [switch]$SkipLaunch
)
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "Android adb not found: $adb" }
$source = "node_modules\trimble-maps-cpik-react-native-library\android\src\main\java\com\alk\cpik\react\CopilotViewManager.java"
if (-not (Test-Path $source)) { throw "Vendor CoPilotViewManager.java missing. Check npm dependencies." }
$output = Join-Path $PSScriptRoot "..\copilot-native-diagnostics.txt"
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("CoPilot native map diagnostics")
$lines.Add("Vendor source: $source")
$lines.Add("Note: this report must be reviewed before CoPilot native view is enabled.")
$lines.Add("--- CoPilot view manager (numbered) ---")
$i = 0
foreach ($line in Get-Content $source) { $i++; $lines.Add(("{0,4}: {1}" -f $i,$line)) }
$lines.Add("--- Device permissions ---")
$permissions = & $adb -s $Device shell dumpsys package $PackageName 2>&1 | Select-String "ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|FOREGROUND_SERVICE_LOCATION|granted="
foreach ($line in $permissions) { $lines.Add([string]$line) }
if (-not $SkipLaunch) {
  $lines.Add("--- Fresh launch ---")
  & $adb -s $Device shell am force-stop $PackageName | Out-Null
  & $adb -s $Device logcat -c | Out-Null
  $launch = & $adb -s $Device shell am start -n "$PackageName/com.semitrax.MainActivity" 2>&1
  foreach ($line in $launch) { $lines.Add([string]$line) }
  Start-Sleep -Seconds 20
  $pidResult = & $adb -s $Device shell pidof $PackageName 2>&1
  $lines.Add("Process PID after 20 seconds: $pidResult")
  $lines.Add("--- Fresh crash buffer ---")
  foreach ($line in (& $adb -s $Device logcat -d -b crash -v time 2>&1)) { $lines.Add([string]$line) }
}
$lines | Set-Content -Path $output -Encoding UTF8
Write-Host "Diagnostic report saved to: $output"
Write-Host "No app data, maps, credentials or keystores were deleted."
