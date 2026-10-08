param([string]$JavaHome = $env:JAVA_HOME, [string]$SdkPath = $env:ANDROID_HOME)
$ErrorActionPreference = 'Stop'
$mobileRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$JavaHome -or !(Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) { throw 'Set -JavaHome to a JDK 21 installation.' }
if (!$SdkPath -or !(Test-Path -LiteralPath (Join-Path $SdkPath 'platforms\android-36\android.jar'))) { throw 'Set -SdkPath to Android SDK with API 36 and build-tools 36.' }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkPath
Push-Location $mobileRoot
try {
    & npm.cmd run sync:device
    if ($LASTEXITCODE -ne 0) { throw 'Web build or native sync failed.' }
    & .\android\gradlew.bat -p android assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    Write-Output (Join-Path $mobileRoot 'android\app\build\outputs\apk\debug\app-debug.apk')
} finally { Pop-Location }
