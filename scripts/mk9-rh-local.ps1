param([ValidateSet('up','down')][string]$Action = 'up')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$workdir = Join-Path $repo 'homologation/rh'
$state = Join-Path $workdir '.env.backend.pid'
$backend = Join-Path $repo 'scripts/mk9-rh-local-backend.ts'
$configuration = Get-Content -Raw (Join-Path $workdir 'supabase/config.toml')
if ($configuration -notmatch '(?m)^project_id = "mk9-rh-homolog"$' -or $configuration -notmatch '(?m)^port = 55321$' -or $configuration -notmatch '(?m)^port = 55322$') { throw 'Unexpected isolated stack configuration.' }
if (Test-Path (Join-Path $workdir 'supabase/.temp/project-ref')) { throw 'Refusing linked project.' }
if ($Action -eq 'down') {
  if (Test-Path $state) {
    $backendProcessId = [int](Get-Content $state)
    $backendProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$backendProcessId"
    if ($backendProcess -and $backendProcess.CommandLine.Contains($backend)) { Stop-Process -Id $backendProcessId }
    elseif ($backendProcess) { throw 'PID belongs to another process; refusing to stop it.' }
    Remove-Item -LiteralPath $state
  }
  $ErrorActionPreference = 'Continue'
  $stopOutput = & supabase.cmd stop --workdir $workdir --project-id mk9-rh-homolog 2>&1
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw 'Could not stop the isolated RH stack.' }
  Write-Output 'RH stack stopped. Volumes preserved.'
  exit
}
$tempDir = Join-Path $workdir 'supabase/.temp'
New-Item -ItemType Directory -Force $tempDir | Out-Null
[System.IO.File]::WriteAllText((Join-Path $tempDir 'postgres-version'), '17.11.0.002')
$ErrorActionPreference = 'Continue'
$startOutput = & supabase.cmd start --workdir $workdir --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,mailpit 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase startup failed; no remote fallback permitted.' }
$ErrorActionPreference = 'Continue'
$statusOutput = & supabase.cmd status --workdir $workdir --output json 2>$null
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase status unavailable.' }
$status = ($statusOutput -join "`n") | ConvertFrom-Json
if ($status.API_URL -ne 'http://127.0.0.1:55321' -or !$status.ANON_KEY) { throw 'Unexpected local Supabase endpoint or missing local key.' }
@{ url=$status.API_URL; key=$status.ANON_KEY } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $workdir '.env.backend.json')
# No CLI status output or service-role credentials are written to logs or printed.
if (Test-Path $state) {
  $existingId = [int](Get-Content $state)
  $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$existingId"
  if ($existing -and $existing.CommandLine.Contains($backend)) { Write-Output 'RH backend already running: http://127.0.0.1:55300'; exit }
  if ($existing) { throw 'Stored PID belongs to another process.' }
}
$nodePath = (Get-Command node.exe).Source
$backendProcess = Start-Process -FilePath $nodePath -ArgumentList @('--import','tsx',('"'+$backend+'"')) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $workdir '.env.backend.stdout') -RedirectStandardError (Join-Path $workdir '.env.backend.stderr')
$backendProcess.Id | Set-Content $state
Start-Sleep -Seconds 2
if ($backendProcess.HasExited) { throw 'RH backend failed to start; inspect local sanitized error log.' }
$health = Invoke-RestMethod 'http://127.0.0.1:55300/health'
if ($health.environment -ne 'mk9-rh-homolog') { throw 'Unexpected backend.' }
Write-Output 'RH backend ready: http://127.0.0.1:55300. External requests disabled.'
