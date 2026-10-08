param(
    [string]$ApiUrl = 'https://semitrax-api.onrender.com',
    [string]$PackageName = 'com.semitrax.app.migration.debug2',
    [switch]$InstallExistingApk
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$androidDir = Join-Path $repoRoot 'android'
$gradleWrapper = Join-Path $androidDir 'gradlew.bat'
$apk = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$logDir = Join-Path $repoRoot 'build\logs'
$logPath = Join-Path $logDir 'refresh-phone-react-native.log'

if (-not (Test-Path -LiteralPath $gradleWrapper -PathType Leaf)) {
    throw "React Native Gradle wrapper not found: $gradleWrapper"
}
if (-not (Test-Path -LiteralPath $adb -PathType Leaf)) {
    throw "Android platform-tools ADB not found: $adb"
}

$apiUri = $null
if (-not [Uri]::TryCreate($ApiUrl, [UriKind]::Absolute, [ref]$apiUri) -or
    $apiUri.Scheme -notin @('http', 'https')) {
    throw 'ApiUrl must be an absolute HTTP or HTTPS address.'
}

$env:SEMITRAX_API_URL = $apiUri.AbsoluteUri.TrimEnd('/')
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not $InstallExistingApk) {
    # CoPilot cannot display until native provisioning is implemented. Fail before
    # bundling a debug APK that has neither a verified CoPilot map nor Mapbox.
    $publicToken = [string]$env:MAPBOX_PUBLIC_TOKEN
    if (-not $publicToken.StartsWith('pk.') -or $publicToken.Length -lt 20) {
        throw 'Map display configuration missing: set MAPBOX_PUBLIC_TOKEN to a valid Mapbox public pk. token in THIS PowerShell session before building. CoPilot native map readiness is not yet available.'
    }
    Write-Host 'Mapbox public display token detected (value hidden).'
    $drive = Get-PSDrive -Name C
    $freeGb = [math]::Round($drive.Free / 1GB, 2)
    if ($freeGb -lt 15) {
        throw "Only $freeGb GB free on C:. Free at least 15 GB before building the native CoPilot APK (25 GB recommended)."
    }

    Push-Location $androidDir
    try {
        Write-Host 'Building SemiTraX React Native debug APK for ARM64...'
        # Windows PowerShell 5.1 promotes native stderr (including harmless Node
        # warnings) to NativeCommandError when ErrorActionPreference is Stop.
        # Keep warning output in the build log and check Gradle's exit code.
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & $gradleWrapper ':app:assembleDebug' '-PreactNativeArchitectures=arm64-v8a' '--no-daemon' '--max-workers=1' '--console=plain' 2>&1 |
                Tee-Object -FilePath $logPath
            $gradleExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($gradleExitCode -ne 0) {
            throw "Android Gradle build failed (exit code $gradleExitCode). See: $logPath"
        }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
    throw "React Native debug APK not found: $apk"
}

& $adb start-server | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ADB server failed to start.' }
$devices = @(& $adb devices | Select-String -Pattern '^\S+\s+device$')
if ($devices.Count -ne 1) {
    throw "Expected one authorized Android phone; found $($devices.Count). Run 'adb devices' and authorize your Samsung."
}

if ($apiUri.IsLoopback) {
    $endpoint = "tcp:$($apiUri.Port)"
    & $adb reverse $endpoint $endpoint | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "ADB reverse tunnel failed for $endpoint" }
}

Write-Host "Installing without clearing SemiTraX app data: $apk"
& $adb install --no-streaming -r -t $apk
if ($LASTEXITCODE -ne 0) {
    throw 'APK installation failed; check application ID/signature compatibility.'
}

& $adb shell am force-stop $PackageName | Out-Null
& $adb shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "APK installed, but could not launch $PackageName." }

$apkInfo = Get-Item -LiteralPath $apk
Write-Host "Installed: $($apkInfo.FullName)"
Write-Host "APK size: $([math]::Round($apkInfo.Length / 1MB, 1)) MB"
Write-Host 'Truck guidance remains disabled until CoPilot licensing, routing coverage, and truck profile are verified on-device.'
