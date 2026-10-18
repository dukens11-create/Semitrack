param(
    [Parameter(Mandatory=$true)][string]$ArtifactFolder,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedCommit
)
$ErrorActionPreference = 'Stop'
$package = 'com.semitrax.app.hybridtest392'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
if (!(Test-Path -LiteralPath $adb)) { throw 'Android platform-tools not found.' }
$actualCommit = (Get-Content -LiteralPath (Join-Path $ArtifactFolder 'build-commit.txt') -Raw).Trim()
if ($actualCommit -ne $ExpectedCommit) { throw 'Artifact commit does not match the reviewed build.' }
$apks = @(Get-ChildItem -LiteralPath $ArtifactFolder -Filter '*.apk')
if ($apks.Count -ne 1) { throw 'Expected exactly one APK in the artifact folder.' }
$apk = $apks[0]
$checksum = ((Get-Content -LiteralPath (Join-Path $ArtifactFolder 'app-debug.apk.sha256') -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $apk.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum.ToLowerInvariant()) {
    throw 'APK checksum mismatch.'
}
$signer = Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Recurse -Filter 'apksigner.bat' |
    Sort-Object FullName -Descending | Select-Object -First 1
if (!$signer) { throw 'Android apksigner is required for safe verification.' }
$aapt = Get-ChildItem -LiteralPath $signer.DirectoryName -Filter 'aapt.exe' | Select-Object -First 1
if (!$signer -or !$aapt) { throw 'Android build-tools (apksigner and aapt) are required for safe verification.' }
$identity = & $aapt.FullName dump badging $apk.FullName
if ($LASTEXITCODE -ne 0 -or !($identity -match ("^package: name='" + [regex]::Escape($package) + "' versionCode='392'"))) {
    throw 'Wrong APK package or version. No installation attempted.'
}
function Read-Certificate([string]$Path) {
    $output = & $signer.FullName verify --print-certs $Path
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $digests = @($output | ForEach-Object {
        if ($_ -match '^\s*(?:V[1-4] )?Signer[^\r\n]*? certificate SHA-256 digest:\s*([a-fA-F0-9]{64})\s*$') { $Matches[1].ToLowerInvariant() }
    } | Sort-Object -Unique)
    if ($digests.Count -ne 1) { throw 'Expected one verifiable APK signing certificate.' }
    return $digests[0]
}
$devices = & $adb devices
if ($LASTEXITCODE -ne 0) { throw 'Could not check the connected phone.' }
$connected = @($devices | Where-Object { $_ -match '^\S+\s+device$' })
if ($connected.Count -ne 1) { throw 'Connect one unlocked phone and accept USB debugging.' }
$serial = ($connected[0] -split '\s+')[0]
$packages = & $adb -s $serial shell pm list packages $package
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect installed packages.' }
$base = @()
if (@($packages | Where-Object { $_.Trim() -eq "package:$package" }).Count -eq 1) {
    $paths = & $adb -s $serial shell pm path $package
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the installed test app.' }
    $base = @($paths | Where-Object { $_ -match '^package:.*/base\.apk\s*$' })
    if ($base.Count -ne 1) { throw 'Could not identify installed test APK. No changes made.' }
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ('SemiTraX-cert-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    # Verify the new APK even for a first installation.
    $newCertificate = Read-Certificate $apk.FullName
    if ($base.Count -eq 1) {
        $installed = Join-Path $temp 'installed.apk'
        & $adb -s $serial pull ($base[0].Substring(8).Trim()) $installed
        if ($LASTEXITCODE -ne 0) { throw 'Could not read the installed APK certificate.' }
        if ((Read-Certificate $installed) -ne $newCertificate) {
            throw 'Signing certificates differ. The existing test app signing key must be recovered. DO NOT uninstall or clear data: that can lose the licensed setup and offline maps.'
        }
    }
    & $adb -s $serial install --no-streaming -r $apk.FullName
    if ($LASTEXITCODE -ne 0) { throw 'Installation failed. Do not uninstall or clear data. Copy the error for review.' }
    Write-Host "Installed SemiTraX Test 392 build $ExpectedCommit. Open Details and verify version 392 and the commit." -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force
}
