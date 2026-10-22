param(
  [string]$Profile = "desktop",
  [string]$Source = "",
  [switch]$Local,
  [switch]$DryRun,
  [string]$DshPath = ""
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
  Write-Host "  .\scripts\install-plugin.ps1 -Local -DshPath 'D:\Program Files\DeepSeek Harness'"
  Write-Host "  .\scripts\install-plugin.ps1 -Local -DryRun"
  Write-Host ""
  Write-Host "Examples:" -ForegroundColor DarkGray
  Write-Host "  Local development:  -Local"
  Write-Host "  GitHub install:     -Source github:YOUR_NAME/dsh-mobile"
  Write-Host "  Custom DSH path:    -Local -DshPath 'D:\Program Files\DeepSeek Harness'"
  exit 1
}

function Resolve-DshRoot([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $null }
  $candidate = $PathValue.Trim().Trim('"')
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    $candidate = Split-Path -Parent $candidate
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { return $null }
  if (-not (Test-Path -LiteralPath (Join-Path $candidate "DeepSeek Harness.exe") -PathType Leaf)) { return $null }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Find-DshCli([string]$RootPath) {
  # A packaged DSH keeps cli.js inside app.asar. PowerShell cannot Test-Path
  # inside an asar archive, but Electron can execute the virtual path.
  $relative = "dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"
  $unpacked = Join-Path $RootPath ("resources\app.asar.unpacked\" + $relative)
  if (Test-Path -LiteralPath $unpacked -PathType Leaf) { return $unpacked }
  $asar = Join-Path $RootPath "resources\app.asar"
  if (Test-Path -LiteralPath $asar -PathType Leaf) {
    return (Join-Path $asar $relative)
  }
  return $null
}

$dshCommand = Get-Command dsh -ErrorAction SilentlyContinue
$dshRoot = $null
$checked = New-Object System.Collections.Generic.List[string]

if (-not [string]::IsNullOrWhiteSpace($DshPath)) {
  $dshRoot = Resolve-DshRoot $DshPath
  if ($null -eq $dshRoot) {
    throw "The path '$DshPath' does not look like a DeepSeek Harness installation. Pass the folder containing DeepSeek Harness.exe, for example: -DshPath 'D:\Program Files\DeepSeek Harness'."
  }
}

if ($null -eq $dshRoot -and -not [string]::IsNullOrWhiteSpace($env:DSH_EXE)) {
  $dshRoot = Resolve-DshRoot $env:DSH_EXE
}

if ($null -eq $dshRoot) {
  $candidates = New-Object System.Collections.Generic.List[string]

  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $baseDirs = @($env:ProgramFiles, $programFilesX86, $env:LOCALAPPDATA, $env:ProgramData)
  foreach ($baseDir in $baseDirs) {
    if ([string]::IsNullOrWhiteSpace($baseDir)) { continue }
    foreach ($sub in @("DeepSeek Harness", "Programs\DeepSeek Harness")) {
      $candidates.Add((Join-Path $baseDir $sub))
    }
  }

  $registryRoots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  foreach ($key in $registryRoots) {
    Get-ItemProperty -Path $key -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.DisplayName -like "*DeepSeek Harness*") {
        if (-not [string]::IsNullOrWhiteSpace($_.InstallLocation)) {
          $candidates.Add($_.InstallLocation)
        }
        if (-not [string]::IsNullOrWhiteSpace($_.DisplayIcon)) {
          $iconPath = ($_.DisplayIcon -split ",")[0].Trim('"')
          if (-not [string]::IsNullOrWhiteSpace($iconPath)) {
            $candidates.Add((Split-Path -Parent $iconPath))
          }
        }
      }
    }
  }

  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "*DeepSeek*" } | ForEach-Object {
    if (-not [string]::IsNullOrWhiteSpace($_.Path)) {
      $candidates.Add((Split-Path -Parent $_.Path))
    }
  }

  Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | ForEach-Object {
    $base = $_.Root
    foreach ($sub in @("Program Files\DeepSeek Harness", "Program Files (x86)\DeepSeek Harness", "DeepSeek Harness", "Apps\DeepSeek Harness")) {
      $candidates.Add((Join-Path $base $sub))
    }
  }

  foreach ($root in ($candidates | Select-Object -Unique)) {
    $checked.Add($root)
    $resolved = Resolve-DshRoot $root
    if ($null -ne $resolved) {
      $dshRoot = $resolved
      break
    }
  }
}

if ($null -ne $dshCommand -and [string]::IsNullOrWhiteSpace($DshPath)) {
  Write-Host "Using DSH CLI: $($dshCommand.Source)" -ForegroundColor DarkGray
  if ($DryRun) {
    Write-Host "Dry run: $($dshCommand.Source) plugin --profile $Profile add $Source" -ForegroundColor Yellow
    return
  }
  & $dshCommand.Source plugin --profile $Profile add $Source
  $exitCode = $LASTEXITCODE
  if (-not $? -or ($null -ne $exitCode -and $exitCode -ne 0)) {
    if ($null -ne $exitCode) { throw "dsh plugin add failed with exit code $exitCode" }
    throw "dsh plugin add failed"
  }
} elseif ($null -ne $dshRoot) {
  $exe = Join-Path $dshRoot "DeepSeek Harness.exe"
  $cli = Find-DshCli $dshRoot
  if ($null -eq $cli) {
    throw "DeepSeek Harness was found at '$dshRoot', but its DSH CLI was not found. Expected: resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"
  }
  Write-Host "Using DeepSeek Harness at: $dshRoot" -ForegroundColor DarkGray
  Write-Host "Installing $Source into DSH profile '$Profile'..." -ForegroundColor Cyan
  if ($DryRun) {
    Write-Host "Dry run: $exe --expose-internals $cli plugin --profile $Profile add $Source" -ForegroundColor Yellow
    return
  }
  $env:ELECTRON_RUN_AS_NODE = "1"
  & $exe --expose-internals $cli plugin --profile $Profile add $Source
  $exitCode = $LASTEXITCODE
  if (-not $? -or ($null -ne $exitCode -and $exitCode -ne 0)) {
    if ($null -ne $exitCode) { throw "dsh plugin add failed with exit code $exitCode" }
    throw "dsh plugin add failed"
  }
} else {
  $looked = ($checked | Select-Object -Unique | Select-Object -First 12) -join [Environment]::NewLine
  throw @"
The dsh command was not found and the DeepSeek Harness installation could not be located.
Pass the installation folder explicitly, for example:
  .\scripts\install-plugin.ps1 -Local -DshPath 'D:\Program Files\DeepSeek Harness'
Or set DSH_EXE to the full path of DeepSeek Harness.exe.
Looked in:
$looked
"@
}

Write-Host ""
Write-Host "Installed. Next:" -ForegroundColor Green
Write-Host "  1. Restart DeepSeek Harness (quit from the tray, then reopen)."
Write-Host "  2. Open DSH Settings -> Plugins and make sure 'dsh-mobile' is enabled."
Write-Host "  3. The pairing page opens automatically; or copy the URL from the DSH log."
Write-Host ""
Write-Host "If the bundle is installed but disabled, enable it in the Plugins page." -ForegroundColor DarkGray
