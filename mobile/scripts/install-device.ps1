param([string]$SdkPath = $env:ANDROID_HOME)
$ErrorActionPreference = 'Stop'
$mobileRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$apkPath = Join-Path $mobileRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
if (!(Test-Path -LiteralPath $apkPath)) { throw 'Build the debug APK first. See mobile/README.md.' }
if (!$SdkPath) {
    $localToolchain = Join-Path $env:USERPROFILE '.cache\tooling\chongchong-android\sdk'
    if (Test-Path -LiteralPath (Join-Path $localToolchain 'platform-tools\adb.exe')) { $SdkPath = $localToolchain }
}
$adbPath = if ($SdkPath) { Join-Path $SdkPath 'platform-tools\adb.exe' } else { (Get-Command adb -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath $adbPath)) { throw 'ADB was not found. Supply -SdkPath.' }
$deviceLines = & $adbPath devices
if ($LASTEXITCODE -ne 0) { throw 'ADB could not list devices.' }
$devices = @($deviceLines | Where-Object { $_ -match '^\S+\s+device$' })
if ($devices.Count -ne 1) { throw 'Connect exactly one Android device and approve USB debugging on the phone, then retry.' }
$serial = ($devices[0] -split '\s+')[0]
& $adbPath -s $serial reverse tcp:4101 tcp:4101
if ($LASTEXITCODE -ne 0) { throw 'USB port forwarding failed.' }
& $adbPath -s $serial install -r $apkPath
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed. Check the phone for an installation prompt.' }
Write-Output 'Installed. Keep backend/npm run mobile running, then open Chongchong on the phone. Enter the Kakao JavaScript key in app connection settings.'
