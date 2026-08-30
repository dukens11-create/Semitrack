param(
    [ValidateSet('validate', 'test-config', 'build-android', 'run')]
    [string]$Action = 'validate',
    [string]$FlutterCommand = 'flutter',
    [string]$CredentialsPath = '',
    [string]$MapboxAccessToken = '',
    [string]$MapboxCredentialsPath = '',
    [string]$ApiUrl = '',
    [ValidateSet('', 'android-arm', 'android-arm64', 'android-x64')]
    [string]$AndroidTargetPlatform = '',
    [switch]$SplitPerAbi
)

$ErrorActionPreference = 'Stop'

function Invoke-FlutterCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
    )

    # Flutter and Gradle legitimately write upgrade warnings to stderr. With
    # ErrorActionPreference=Stop, PowerShell can turn those warnings into a
    # NativeCommandError even when Flutter exits successfully and creates the
    # APK. Always decide success from the native process exit code instead.
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = 1
    try {
        $ErrorActionPreference = 'Continue'
        # Builds must be reproducible and must not mutate the bundled Flutter
        # SDK's Git metadata merely to check for a newer framework release.
        & $FlutterCommand '--no-version-check' @Arguments
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw $FailureMessage
    }
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$defaultCredentialsPath = Join-Path $repoRoot 'config\here\credentials.properties'
$defaultMapboxCredentialsPath = Join-Path $repoRoot 'config\mapbox\credentials.properties'
if ([string]::IsNullOrWhiteSpace($CredentialsPath)) {
    $CredentialsPath = $defaultCredentialsPath
}
$credentialsPath = [IO.Path]::GetFullPath($CredentialsPath)
if ([string]::IsNullOrWhiteSpace($MapboxCredentialsPath)) {
    $MapboxCredentialsPath = $defaultMapboxCredentialsPath
}
$mapboxCredentialsPath = [IO.Path]::GetFullPath($MapboxCredentialsPath)
$pluginPath = Join-Path $repoRoot 'plugins\here_sdk'
$pubspecPath = Join-Path $repoRoot 'pubspec.yaml'

if (-not (Test-Path -LiteralPath $credentialsPath -PathType Leaf)) {
    throw "Missing HERE SDK credentials file: $credentialsPath"
}

$properties = @{}
foreach ($line in Get-Content -LiteralPath $credentialsPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
        continue
    }
    $parts = $trimmed.Split('=', 2)
    $properties[$parts[0].Trim()] = $parts[1].Trim()
}

foreach ($requiredKey in @('here.access.key.id', 'here.access.key.secret')) {
    $value = $properties[$requiredKey]
    if ([string]::IsNullOrWhiteSpace($value) -or $value.StartsWith('YOUR_')) {
        throw "HERE SDK credentials file is missing a real $requiredKey value."
    }
}

if ([string]::IsNullOrWhiteSpace($MapboxAccessToken)) {
    $MapboxAccessToken = $env:MAPBOX_ACCESS_TOKEN
}
if ([string]::IsNullOrWhiteSpace($MapboxAccessToken) -and
    (Test-Path -LiteralPath $mapboxCredentialsPath -PathType Leaf)) {
    foreach ($line in Get-Content -LiteralPath $mapboxCredentialsPath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
            continue
        }
        $parts = $trimmed.Split('=', 2)
        if ($parts[0].Trim() -eq 'MAPBOX_ACCESS_TOKEN') {
            $MapboxAccessToken = $parts[1].Trim()
            break
        }
    }
}

Write-Host 'HERE SDK credentials file is valid (credential values hidden).'
if ($Action -eq 'validate') {
    exit 0
}

if ($Action -in @('build-android', 'run') -and
    [string]::IsNullOrWhiteSpace($MapboxAccessToken)) {
    throw "Missing Mapbox public access token. Copy the template to $mapboxCredentialsPath and set MAPBOX_ACCESS_TOKEN to a pk. token."
}
if (-not [string]::IsNullOrWhiteSpace($MapboxAccessToken) -and
    -not $MapboxAccessToken.StartsWith('pk.')) {
    throw 'MAPBOX_ACCESS_TOKEN must be a public pk. token. Never use the secret downloads token as a Dart define.'
}

$temporaryDefinesPath = [IO.Path]::GetTempFileName()
$defines = @{
    HERE_ACCESS_KEY_ID = $properties['here.access.key.id']
    HERE_ACCESS_KEY_SECRET = $properties['here.access.key.secret']
}
if (-not [string]::IsNullOrWhiteSpace($MapboxAccessToken)) {
    $defines['MAPBOX_ACCESS_TOKEN'] = $MapboxAccessToken
}
if (-not [string]::IsNullOrWhiteSpace($ApiUrl)) {
    $parsedApiUrl = $null
    if (-not [Uri]::TryCreate($ApiUrl, [UriKind]::Absolute, [ref]$parsedApiUrl) -or
        $parsedApiUrl.Scheme -notin @('http', 'https')) {
        throw 'ApiUrl must be an absolute HTTP or HTTPS URL.'
    }
    $defines['SEMITRACK_API_URL'] = $parsedApiUrl.AbsoluteUri.TrimEnd('/')
}
[IO.File]::WriteAllText(
    $temporaryDefinesPath,
    ($defines | ConvertTo-Json -Compress),
    [Text.UTF8Encoding]::new($false)
)

Push-Location $repoRoot
try {
    if ($Action -eq 'test-config') {
        Invoke-FlutterCommand -Arguments @(
            'test',
            "--dart-define-from-file=$temporaryDefinesPath",
            'test/here_sdk_config_test.dart'
        ) -FailureMessage 'HERE SDK configuration test failed.'
        return
    }

    if (-not (Test-Path -LiteralPath $pluginPath -PathType Container)) {
        throw 'HERE Flutter SDK plugin is missing. Extract the licensed 4.27.2.0 plugin to plugins\here_sdk first.'
    }
    if (-not (Select-String -LiteralPath $pubspecPath -Pattern '^\s+here_sdk:\s*$' -Quiet)) {
        throw 'pubspec.yaml does not yet enable the here_sdk local path dependency.'
    }

    Invoke-FlutterCommand -Arguments @('pub', 'get') `
        -FailureMessage 'Flutter dependency resolution failed.'
    if ($Action -eq 'run') {
        Invoke-FlutterCommand -Arguments @(
            'run',
            "--dart-define-from-file=$temporaryDefinesPath"
        ) -FailureMessage 'Flutter run failed.'
        return
    }
    $buildArguments = @(
        'build',
        'apk',
        '--debug',
        "--dart-define-from-file=$temporaryDefinesPath"
    )
    if (-not [string]::IsNullOrWhiteSpace($AndroidTargetPlatform)) {
        $buildArguments += @('--target-platform', $AndroidTargetPlatform)
    }
    if ($SplitPerAbi) {
        $buildArguments += '--split-per-abi'
    }
    Invoke-FlutterCommand -Arguments $buildArguments `
        -FailureMessage 'Android debug build failed.'
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $temporaryDefinesPath -PathType Leaf) {
        Remove-Item -LiteralPath $temporaryDefinesPath -Force
    }
}
