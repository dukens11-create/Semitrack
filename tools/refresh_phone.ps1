param(
    [string]$FlutterCommand = 'C:\Users\duken\Documents\Codex\tools\flutter\bin\flutter.bat',
    [string]$ApiUrl = '',
    [string]$PackageName = 'com.example.semitrack_mobile',
    [switch]$InstallExistingApk
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hereBuildScript = Join-Path $PSScriptRoot 'here_flutter.ps1'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$javaHome = 'C:\Program Files\Android\Android Studio\jbr'
$gradleUserHome = Join-Path $env:LOCALAPPDATA 'SemiTraX\gradle-cache'
$buildLogDirectory = Join-Path $repoRoot 'build\logs'
$buildLog = Join-Path $buildLogDirectory 'refresh-phone.log'
$expectedApk = Join-Path $repoRoot 'build\app\outputs\flutter-apk\app-arm64-v8a-debug.apk'
$gradleApk = Join-Path $repoRoot 'build\app\outputs\apk\debug\app-arm64-v8a-debug.apk'
$parsedApiUrl = $null

if (-not (Test-Path -LiteralPath $FlutterCommand -PathType Leaf)) {
    throw "Flutter was not found at $FlutterCommand"
}
if (-not (Test-Path -LiteralPath $adb -PathType Leaf)) {
    throw "ADB was not found at $adb"
}
if (Test-Path -LiteralPath $javaHome -PathType Container) {
    $env:JAVA_HOME = $javaHome
}
$env:GRADLE_USER_HOME = $gradleUserHome
New-Item -ItemType Directory -Path $gradleUserHome -Force | Out-Null
New-Item -ItemType Directory -Path $buildLogDirectory -Force | Out-Null

Push-Location $repoRoot
try {
    if ($InstallExistingApk) {
        Write-Host 'Using the existing SemiTraX arm64 debug APK...'
    } else {
        Write-Host 'Building the latest SemiTraX arm64 debug APK...'
    }
    # A failed/sandboxed build can leave a directory whose name is the same as
    # Flutter's APK output. Gradle cannot replace that directory with the APK.
    if (Test-Path -LiteralPath $expectedApk -PathType Container) {
        $blockingItems = @(Get-ChildItem -LiteralPath $expectedApk -Force)
        if ($blockingItems.Count -gt 0) {
            throw "The expected APK path is a non-empty directory: $expectedApk"
        }
        Remove-Item -LiteralPath $expectedApk -Force
    }
    if (-not $InstallExistingApk) {
        if ($ApiUrl -match '^\[(https?://[^\]]+)\]\((https?://[^\)]+)\)$') {
            # Accept an address copied from a UI that rendered it as a Markdown
            # link, while still passing only the actual URL to the build helper.
            $ApiUrl = $Matches[2]
        }
        if (-not [string]::IsNullOrWhiteSpace($ApiUrl)) {
            $candidateApiUrl = $null
            if (-not [Uri]::TryCreate($ApiUrl, [UriKind]::Absolute, [ref]$candidateApiUrl) -or
                $candidateApiUrl.Scheme -notin @('http', 'https') -or
                $candidateApiUrl.Port -le 0) {
                throw "ApiUrl must be a complete HTTP or HTTPS URL, for example http://127.0.0.1:4000."
            }
            $parsedApiUrl = $candidateApiUrl
            if ($parsedApiUrl.IsLoopback) {
                $healthUrl = "{0}://{1}:{2}/health" -f
                    $parsedApiUrl.Scheme,
                    $parsedApiUrl.Host,
                    $parsedApiUrl.Port
                try {
                    $healthResponse = Invoke-WebRequest `
                        -Uri $healthUrl `
                        -UseBasicParsing `
                        -TimeoutSec 5
                    if ($healthResponse.StatusCode -ne 200) {
                        throw "Health check returned HTTP $($healthResponse.StatusCode)."
                    }
                } catch {
                    throw "The local SemiTraX API is not responding at $healthUrl. Start it in another PowerShell window with: cd $repoRoot\apps\api; npm run dev"
                }
                Write-Host "Local SemiTraX API health check passed: $healthUrl"
            }
        }
        $buildArguments = @{
            Action = 'build-android'
            FlutterCommand = $FlutterCommand
            AndroidTargetPlatform = 'android-arm64'
            SplitPerAbi = $true
        }
        if (-not [string]::IsNullOrWhiteSpace($ApiUrl)) {
            $buildArguments.ApiUrl = $ApiUrl
        }
        try {
            & $hereBuildScript @buildArguments 2>&1 |
                Tee-Object -LiteralPath $buildLog
            if ($LASTEXITCODE -ne 0) {
                throw 'Android build failed.'
            }
        } catch {
            $_ | Out-String | Add-Content -LiteralPath $buildLog
            throw "Android build failed. Complete output is saved in $buildLog"
        }
    }

    $apk = if ($InstallExistingApk) { $gradleApk } else { $expectedApk }
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
        throw "The build completed but the expected APK was not found at $apk"
    }

    & $adb start-server | Out-Null
    Write-Host 'Waiting up to 30 seconds for an authorized Android phone...'
    $deviceOutput = @()
    $authorizedDevices = @()
    $authorizationDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $deviceOutput = @(& $adb devices -l)
        $authorizedDevices = @(
            $deviceOutput | Select-String -Pattern "\sdevice(?:\s|$)"
        )
        if ($authorizedDevices.Count -gt 0) {
            break
        }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $authorizationDeadline)

    if ($authorizedDevices.Count -eq 0) {
        $unauthorizedDevices = @(
            $deviceOutput | Select-String -Pattern "\sunauthorized(?:\s|$)"
        )
        $offlineDevices = @(
            $deviceOutput | Select-String -Pattern "\soffline(?:\s|$)"
        )
        if ($unauthorizedDevices.Count -gt 0) {
            throw 'The Android phone is connected but unauthorized. Unlock it, accept the Allow USB debugging prompt, select Always allow from this computer, and run this command again.'
        }
        if ($offlineDevices.Count -gt 0) {
            throw 'The Android phone is connected but offline. Unplug and reconnect the USB cable, unlock the phone, and run this command again.'
        }
        throw 'No Android phone is connected through ADB. Connect the unlocked phone with a USB data cable, set USB mode to File transfer / Android Auto, enable USB debugging, and run this command again.'
    }
    if ($authorizedDevices.Count -gt 1) {
        throw 'More than one Android device is connected. Disconnect the device that should not receive this build.'
    }

    # A physical Android device treats 127.0.0.1 as the phone itself. When a
    # local loopback API URL is compiled into a debug build, create the USB
    # reverse tunnel automatically so requests reach the development server on
    # this computer. This is intentionally limited to loopback development URLs.
    if ($null -ne $parsedApiUrl -and $parsedApiUrl.IsLoopback) {
        $reverseEndpoint = "tcp:$($parsedApiUrl.Port)"
        & $adb reverse $reverseEndpoint $reverseEndpoint | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create the ADB reverse tunnel for $reverseEndpoint."
        }
        Write-Host "ADB reverse tunnel ready: $reverseEndpoint"
    }

    $dataLine = (& $adb shell df -k /data | Select-Object -Last 1) -split '\s+'
    if ($dataLine.Count -ge 4) {
        $availableKb = 0L
        if ([long]::TryParse($dataLine[3], [ref]$availableKb) -and $availableKb -lt 786432) {
            throw 'The phone has less than 768 MB free. Free storage on the phone before installing SemiTraX.'
        }
    }

    Write-Host "Installing $apk without clearing app data..."
    & $adb install --no-streaming -r -t $apk
    if ($LASTEXITCODE -ne 0) {
        throw 'APK installation failed.'
    }

    & $adb shell am force-stop $PackageName | Out-Null
    & $adb shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'SemiTraX was installed, but Android could not relaunch it.'
    }

    $apkInfo = Get-Item -LiteralPath $apk
    Write-Host "SemiTraX refreshed successfully: $($apkInfo.FullName)"
    Write-Host "APK size: $([math]::Round($apkInfo.Length / 1MB, 1)) MB"
} finally {
    Pop-Location
}
