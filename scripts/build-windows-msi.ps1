#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

npm ci
node --check src\main.js

cargo test --locked

npm run tauri -- build --bundles msi

New-Item dist -ItemType Directory -Force | Out-Null

$msiFile = Get-ChildItem -Path "src-tauri\target\release\bundle\msi" -Filter "*.msi" | Select-Object -First 1
if ($msiFile) {
    Copy-Item $msiFile.FullName "dist\differ-windows-x64.msi"
    Write-Host "MSI created: dist\differ-windows-x64.msi"
} else {
    throw "MSI file not found in src-tauri\target\release\bundle\msi"
}
