$ErrorActionPreference = 'Stop'
$backupScript = Join-Path $PSScriptRoot 'mk9-prod-backup.ps1'
$output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -TestAcl 2>&1 | Out-String
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    throw "ACL regression test failed (exit $exitCode). No secrets were requested by this test."
}
if ($output -notmatch 'ACL regression test passed') {
    throw 'ACL regression test did not report success.'
}
Write-Output $output.Trim()
