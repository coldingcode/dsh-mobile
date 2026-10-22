param(
  [string]$Profile = "desktop",
  [string]$Source = "",
  [switch]$Local
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($Local) {
  $Source = "link:" + $repoRoot
}

if ([string]::IsNullOrWhiteSpace($Source)) {
  Write-Host "Usage:" -ForegroundColor Yellow
  Write-Host "  .\scripts\install-plugin.ps1 -Local"
  Write-Host "  .\scripts\install-plugin.ps1 -Source github:YOUR_NAME/dsh-mobile"
  Write-Host ""
  Write-Host "Examples:" -ForegroundColor DarkGray
  Write-Host "  Local development:  -Local"
  Write-Host "  GitHub install:     -Source github:YOUR_NAME/dsh-mobile"
  exit 1
}

$dshCommand = Get-Command dsh -ErrorAction SilentlyContinue
if ($null -ne $dshCommand) {
  Write-Host "Installing $Source into DSH profile '$Profile'..." -ForegroundColor Cyan
  & $dshCommand.Source plugin --profile $Profile add $Source
  if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed with exit code $LASTEXITCODE" }
} else {
  $roots = @(
    (Join-Path $env:ProgramFiles "DeepSeek Harness"),
    (Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness")
  ) | Where-Object { $_ -and (Test-Path $_) }

  $dshRoot = $roots | Where-Object {
    Test-Path (Join-Path $_ "DeepSeek Harness.exe")
  } | Select-Object -First 1

  if (-not $dshRoot) {
    throw "The dsh command was not found and the DeepSeek Harness installation could not be located. Install the DSH CLI or run this script from a machine with DSH."
  }

  $exe = Join-Path $dshRoot "DeepSeek Harness.exe"
  $cli = Join-Path $dshRoot "resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"
  if (-not (Test-Path $cli)) { throw "DSH CLI was not found at $cli" }

  Write-Host "Installing $Source into DSH profile '$Profile'..." -ForegroundColor Cyan
  $env:ELECTRON_RUN_AS_NODE = "1"
  & $exe --expose-internals $cli plugin --profile $Profile add $Source
  if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed with exit code $LASTEXITCODE" }
}

Write-Host ""
Write-Host "Installed. Next:" -ForegroundColor Green
Write-Host "  1. Restart DeepSeek Harness (quit from the tray, then reopen)."
Write-Host "  2. Open DSH Settings -> Plugins and make sure 'dsh-mobile' is enabled."
Write-Host "  3. The pairing page opens automatically; or copy the URL from the DSH log."
Write-Host ""
Write-Host "If the bundle is installed but disabled, enable it in the Plugins page." -ForegroundColor DarkGray
