[CmdletBinding()]
param(
    [switch]$Configure,
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ProjectRef = 'xzmbesqhxcnuokjwrbnw'
$script:ProjectUrl = "https://$($script:ProjectRef).supabase.co"
$script:PgBin = 'C:\Tools\MK9-Date\postgresql-17.12\pgsql\bin'
$script:AgeExe = (Get-Command age -ErrorAction SilentlyContinue).Source
$script:AgeKeygenExe = (Get-Command age-keygen -ErrorAction SilentlyContinue).Source
$script:ConfigHome = Join-Path $env:LOCALAPPDATA 'MK9-Date\ProductionBackup'
$script:ConfigPath = Join-Path $script:ConfigHome 'config.json'
$script:DbCredentialPath = Join-Path $script:ConfigHome 'database.credential.xml'
$script:ApiCredentialPath = Join-Path $script:ConfigHome 'service-role.credential.xml'
$script:IdentityPath = Join-Path $script:ConfigHome 'age-identity.txt'
$script:BackupRoot = Join-Path $script:ConfigHome 'Backups'

function Protect-PrivateDirectory([string]$Path) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @($currentSid, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Assert-Tools {
    foreach ($file in @('pg_dump.exe', 'pg_restore.exe', 'pg_isready.exe', 'psql.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $script:PgBin $file) -PathType Leaf)) {
            throw "Ferramenta PostgreSQL ausente: $file"
        }
    }
    if (-not $script:AgeExe -or -not $script:AgeKeygenExe) { throw 'age e age-keygen precisam estar no PATH.' }
    $dumpVersion = (& (Join-Path $script:PgBin 'pg_dump.exe') --version 2>$null | Out-String).Trim()
    $restoreVersion = (& (Join-Path $script:PgBin 'pg_restore.exe') --version 2>$null | Out-String).Trim()
    if ($dumpVersion -notmatch '^pg_dump \(PostgreSQL\) 17\.' -or $restoreVersion -notmatch '^pg_restore \(PostgreSQL\) 17\.') {
        throw 'pg_dump e pg_restore devem ser PostgreSQL 17.'
    }
}

function Invoke-Configure {
    Assert-Tools
    Protect-PrivateDirectory $script:ConfigHome
    Write-Host 'Informe uma vez as credenciais do projeto de produÃ§Ã£o. O XML serÃ¡ protegido por DPAPI para este usuÃ¡rio do Windows.'
    $dbPassword = Read-Host 'Senha do usuÃ¡rio PostgreSQL postgres.xzmbesqhxcnuokjwrbnw' -AsSecureString
    $serviceKey = Read-Host 'Chave service_role do projeto de produÃ§Ã£o' -AsSecureString
    $recipient = (Read-Host 'DestinatÃ¡rio age pÃºblico (age1...)').Trim()
    $identitySource = (Read-Host 'Caminho da identidade privada age correspondente').Trim().Trim('"')
    if ($recipient -notmatch '^age1[0-9a-z]+$') { throw 'DestinatÃ¡rio age invÃ¡lido.' }
    if (-not (Test-Path -LiteralPath $identitySource -PathType Leaf)) { throw 'Arquivo da identidade privada age nÃ£o encontrado.' }
    $derived = (& $script:AgeKeygenExe -y $identitySource 2>$null | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or $derived -ne $recipient) { throw 'A identidade privada nÃ£o corresponde ao destinatÃ¡rio age informado.' }
    $identityContent = Get-Content -LiteralPath $identitySource -Raw
    if ($identityContent -notmatch 'AGE-SECRET-KEY-1') { throw 'O arquivo nÃ£o contÃ©m uma identidade privada age vÃ¡lida.' }
    Copy-Item -LiteralPath $identitySource -Destination $script:IdentityPath -Force
    $dbCredential = New-Object System.Management.Automation.PSCredential('postgres.xzmbesqhxcnuokjwrbnw', $dbPassword)
    $apiCredential = New-Object System.Management.Automation.PSCredential('service_role', $serviceKey)
    $dbCredential | Export-Clixml -LiteralPath $script:DbCredentialPath -Force
    $apiCredential | Export-Clixml -LiteralPath $script:ApiCredentialPath -Force
    $config = [ordered]@{ projectRef = $script:ProjectRef; projectUrl = $script:ProjectUrl; ageRecipient = $recipient }
    $config | ConvertTo-Json | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
    Write-Host "ConfiguraÃ§Ã£o protegida salva em $script:ConfigHome"
}

function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-Manifest([string]$Root, [hashtable]$Counts) {
    $files = @()
    foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse | Where-Object { $_.Name -ne 'pgpass.conf' } | Sort-Object FullName) {
        $relative = $file.FullName.Substring($Root.Length).TrimStart('\') -replace '\\', '/'
        $files += [ordered]@{ path = $relative; bytes = $file.Length; sha256 = (Get-Sha256 $file.FullName) }
    }
    $manifest = [ordered]@{
        format = 'mk9-production-backup-v1'
        projectRef = $script:ProjectRef
        createdAtUtc = [DateTime]::UtcNow.ToString('o')
        counts = $Counts
        files = $files
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Root 'manifest.json') -Encoding UTF8
}

function Assert-Manifest([string]$Root) {
    $manifestPath = Join-Path $Root 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Manifest ausente no pacote recuperado.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.projectRef -ne $script:ProjectRef) { throw 'Manifest pertence a outro projeto.' }
    $expectedPaths = @($manifest.files | ForEach-Object { $_.path })
    foreach ($entry in $manifest.files) {
        $candidate = [IO.Path]::GetFullPath((Join-Path $Root ($entry.path -replace '/', '\')))
        $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
        if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Caminho invÃ¡lido no manifest.' }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Arquivo ausente no pacote recuperado: $($entry.path)" }
        $item = Get-Item -LiteralPath $candidate
        if ($item.Length -ne [long]$entry.bytes -or (Get-Sha256 $candidate) -ne $entry.sha256) { throw "Falha de integridade em $($entry.path)." }
    }
    $actualPaths = @(Get-ChildItem -LiteralPath $Root -File -Recurse | Where-Object { $_.Name -notin @('manifest.json', 'pgpass.conf') } | ForEach-Object { $_.FullName.Substring($Root.Length).TrimStart('\') -replace '\\', '/' })
    if (@(Compare-Object ($expectedPaths | Sort-Object) ($actualPaths | Sort-Object)).Count -ne 0) { throw 'O pacote contÃ©m arquivos ausentes ou nÃ£o inventariados.' }
}

function Invoke-SelfTest {
    Assert-Tools
    $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('mk9-backup-selftest-' + [guid]::NewGuid().ToString('N'))
    $plain = Join-Path $testRoot 'fixture.zip'
    $cipher = Join-Path $testRoot 'fixture.zip.age'
    $decrypted = Join-Path $testRoot 'recovered.zip'
    $extract = Join-Path $testRoot 'recovered'
    $identity = Join-Path $testRoot 'identity.txt'
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    try {
        $payload = Join-Path $testRoot 'payload'
        New-Item -ItemType Directory -Path (Join-Path $payload 'storage\fixture-bucket') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $payload 'auth') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $payload 'database.dump') -Value 'synthetic-database-fixture' -Encoding ASCII
        Set-Content -LiteralPath (Join-Path $payload 'auth\users.json') -Value '{"users":[{"id":"fixture-user"}]}' -Encoding UTF8
        Set-Content -LiteralPath (Join-Path $payload 'storage\fixture-bucket\fixture.txt') -Value 'synthetic-storage-fixture' -Encoding ASCII
        Set-Content -LiteralPath (Join-Path $payload 'pgpass.conf') -Value 'synthetic-secret-must-not-enter-archive' -Encoding ASCII
        Write-Manifest $payload @{ authUsers = 1; storageBuckets = 1; storageObjects = 1; databaseObjects = 1 }
        if ((Get-Content (Join-Path $payload 'manifest.json') -Raw) -match 'pgpass.conf') { throw 'Temporary password file was added to the manifest.' }
        Assert-Manifest $payload
        Compress-Archive -Path (Join-Path $payload 'database.dump'),(Join-Path $payload 'auth'),(Join-Path $payload 'storage'),(Join-Path $payload 'manifest.json') -DestinationPath $plain -CompressionLevel Optimal
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $script:AgeKeygenExe -o $identity 2>$null | Out-Null
        $keygenExitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        if ($keygenExitCode -ne 0) { throw 'age-keygen falhou no self-test.' }
        $recipient = (& $script:AgeKeygenExe -y $identity 2>$null | Select-Object -Last 1).Trim()
        & $script:AgeExe -r $recipient -o $cipher $plain 2>$null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $cipher)) { throw 'Criptografia age falhou no self-test.' }
        $cipherHash = Get-Sha256 $cipher
        & $script:AgeExe -d -i $identity -o $decrypted $cipher 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Descriptografia age falhou no self-test.' }
        if ($cipherHash -ne (Get-Sha256 $cipher)) { throw 'Ciphertext SHA-256 changed.' }
        Expand-Archive -LiteralPath $decrypted -DestinationPath $extract
        Assert-Manifest $extract
        if ((Get-Content (Join-Path $extract 'auth\users.json') -Raw) -notmatch 'fixture-user') { throw 'Fixture Auth nÃ£o foi recuperado.' }
        if ((Get-Content (Join-Path $extract 'storage\fixture-bucket\fixture.txt') -Raw) -notmatch 'synthetic-storage-fixture') { throw 'Fixture Storage nÃ£o foi recuperado.' }
        Set-Content -LiteralPath (Join-Path $extract 'storage\fixture-bucket\fixture.txt') -Value 'tampered' -Encoding ASCII
        $integrityFailed = $false
        try { Assert-Manifest $extract } catch { $integrityFailed = $true }
        if (-not $integrityFailed) { throw 'Internal-file integrity failure was not detected.' }
        $badCipher = Join-Path $testRoot 'corrupt.age'
        Set-Content -LiteralPath $badCipher -Value 'corrupt' -Encoding ASCII
        $failedAsExpected = $false
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $script:AgeExe -d -i $identity -o (Join-Path $testRoot 'bad.zip') $badCipher 2>$null
        if ($LASTEXITCODE -ne 0) { $failedAsExpected = $true }
        $ErrorActionPreference = $previousPreference
        if (-not $failedAsExpected) { throw 'O teste nÃ£o detectou arquivo cifrado invÃ¡lido.' }
        Write-Host 'SELF-TEST OK: fixture, manifesto, SHA-256, criptografia, descriptografia, integridade e falha de ciphertext.'
    }
    finally {
        if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
        if (Test-Path -LiteralPath $testRoot) { throw 'Falha na limpeza dos temporÃ¡rios do self-test.' }
    }
}

function Escape-PgPass([string]$Value) { $Value.Replace('\', '\\').Replace(':', '\:') }

function Invoke-ProductionBackup {
    Assert-Tools
    foreach ($path in @($script:ConfigPath, $script:DbCredentialPath, $script:ApiCredentialPath, $script:IdentityPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "ConfiguraÃ§Ã£o/credencial ausente: $path. Execute primeiro -Configure." }
    }
    $config = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
    if ($config.projectRef -ne $script:ProjectRef -or $config.projectUrl -ne $script:ProjectUrl) { throw 'Destino configurado nÃ£o Ã© o projeto de produÃ§Ã£o autorizado.' }
    if ($config.ageRecipient -notmatch '^age1[0-9a-z]+$') { throw 'DestinatÃ¡rio age invÃ¡lido na configuraÃ§Ã£o.' }
    $derived = (& $script:AgeKeygenExe -y $script:IdentityPath 2>$null | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or $derived -ne $config.ageRecipient) { throw 'Identidade age nÃ£o corresponde ao destinatÃ¡rio configurado.' }
    $dbCredential = Import-Clixml -LiteralPath $script:DbCredentialPath
    $apiCredential = Import-Clixml -LiteralPath $script:ApiCredentialPath
    if ($dbCredential.UserName -ne "postgres.$($script:ProjectRef)" -or $apiCredential.UserName -ne 'service_role') { throw 'As credenciais protegidas nÃ£o sÃ£o do formato esperado.' }

    Protect-PrivateDirectory $script:BackupRoot
    $runId = [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $work = Join-Path $script:BackupRoot ('.work-' + [guid]::NewGuid().ToString('N'))
    $final = Join-Path $script:BackupRoot "mk9-production-$runId.zip.age"
    if (Test-Path -LiteralPath $final) { throw 'Backup target already exists; refusing to overwrite.' }
    $reportPath = Join-Path $script:BackupRoot "mk9-production-$runId.report.json"
    New-Item -ItemType Directory -Path $work | Out-Null
    Set-Acl -LiteralPath $work -AclObject (Get-Acl -LiteralPath $script:BackupRoot)
    $pgpass = Join-Path $work 'pgpass.conf'
    $zip = Join-Path $work 'backup.zip'
    $recovery = Join-Path $work 'recovered.zip'
    $extract = Join-Path $work 'recovered'
    $hadPgPassFile = Test-Path Env:\PGPASSFILE
    $previousPgPassFile = $env:PGPASSFILE
    $hadSslMode = Test-Path Env:\PGSSLMODE
    $previousSslMode = $env:PGSSLMODE
    $env:PGPASSFILE = $pgpass
    $env:PGSSLMODE = 'require'
    $dbPassword = $dbCredential.GetNetworkCredential().Password
    $apiKey = $apiCredential.GetNetworkCredential().Password
    try {
        $pgpassLine = 'db.xzmbesqhxcnuokjwrbnw.supabase.co:5432:postgres:postgres.' + $script:ProjectRef + ':' + (Escape-PgPass $dbPassword)
        Set-Content -LiteralPath $pgpass -Value $pgpassLine -Encoding ASCII
        $hostName = "db.$($script:ProjectRef).supabase.co"
        $readyOutput = & (Join-Path $script:PgBin 'pg_isready.exe') -h $hostName -p 5432 -d postgres -U $dbCredential.UserName -t 8 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Preflight PostgreSQL falhou; verifique rede, senha e disponibilidade do projeto.' }
        $identity = & (Join-Path $script:PgBin 'psql.exe') -X -A -t -v ON_ERROR_STOP=1 -h $hostName -p 5432 -d postgres -U $dbCredential.UserName -c 'select current_database()' 2>$null
        if ($LASTEXITCODE -ne 0 -or ($identity | Out-String).Trim() -ne 'postgres') { throw 'Preflight SQL nÃ£o confirmou o banco postgres.' }

        $headers = @{ apikey = $apiKey; Authorization = "Bearer $apiKey" }
        $settings = Invoke-RestMethod -Method Get -Uri "$($script:ProjectUrl)/auth/v1/settings" -Headers $headers -TimeoutSec 30
        if (-not $settings) { throw 'Preflight Auth nÃ£o confirmou a identidade do projeto.' }

        $databaseDump = Join-Path $work 'database.dump'
        & (Join-Path $script:PgBin 'pg_dump.exe') -h $hostName -p 5432 -U $dbCredential.UserName -d postgres -Fc -f $databaseDump 2>$null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $databaseDump) -or (Get-Item $databaseDump).Length -eq 0) { throw 'pg_dump falhou; nenhum backup serÃ¡ declarado vÃ¡lido.' }
        & (Join-Path $script:PgBin 'pg_restore.exe') --list $databaseDump 2>$null | Out-File -FilePath (Join-Path $work 'database.toc.txt') -Encoding ASCII
        if ($LASTEXITCODE -ne 0) { throw 'ValidaÃ§Ã£o TOC de pg_dump falhou.' }
        $dbObjects = @(Get-Content (Join-Path $work 'database.toc.txt') | Where-Object { $_ -match '^\d+;\s+\d+\s+\d+\s+' }).Count
        if ($dbObjects -lt 1) { throw 'O dump do banco nÃ£o contÃ©m objetos listÃ¡veis.' }

        $authDir = Join-Path $work 'auth'
        New-Item -ItemType Directory -Path $authDir | Out-Null
        $users = [Collections.Generic.List[object]]::new()
        $page = 1
        do {
            $response = Invoke-RestMethod -Method Get -Uri "$($script:ProjectUrl)/auth/v1/admin/users?page=$page`&per_page=1000" -Headers $headers -TimeoutSec 60
            $batch = @($response.users)
            foreach ($user in $batch) { $users.Add($user) }
            $page++
        } while ($batch.Count -eq 1000)
        @{ users = @($users) } | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $authDir 'users.json') -Encoding UTF8

        $storageRoot = Join-Path $work 'storage'
        New-Item -ItemType Directory -Path $storageRoot | Out-Null
        $buckets = @(Invoke-RestMethod -Method Get -Uri "$($script:ProjectUrl)/storage/v1/bucket" -Headers $headers -TimeoutSec 60)
        $storageCount = 0
        foreach ($bucket in $buckets) {
            $bucketRoot = Join-Path $storageRoot $bucket.name
            New-Item -ItemType Directory -Path $bucketRoot -Force | Out-Null
            $queue = [Collections.Generic.Queue[string]]::new()
            $queue.Enqueue('')
            while ($queue.Count -gt 0) {
                $prefix = $queue.Dequeue()
                $offset = 0
                do {
                    $body = @{ prefix = $prefix; limit = 1000; offset = $offset; sortBy = @{ column = 'name'; order = 'asc' } } | ConvertTo-Json -Compress
                    $listUri = "$($script:ProjectUrl)/storage/v1/object/list/$([uri]::EscapeDataString($bucket.name))"
                    $items = @(Invoke-RestMethod -Method Post -Uri $listUri -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 60)
                    foreach ($item in $items) {
                        $relative = if ($prefix) { "$prefix/$($item.name)" } else { [string]$item.name }
                        $relative = $relative -replace '/', '\'
                        $target = [IO.Path]::GetFullPath((Join-Path $bucketRoot $relative))
                        $bucketPrefix = [IO.Path]::GetFullPath($bucketRoot).TrimEnd('\') + '\'
                        if (-not $target.StartsWith($bucketPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Storage retornou caminho fora do bucket.' }
                        if ($null -eq $item.id) {
                            $queue.Enqueue($relative -replace '\\', '/')
                            New-Item -ItemType Directory -Path $target -Force | Out-Null
                        } else {
                            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                            $encodedPath = (($relative -replace '\\', '/') -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
                            $downloadUri = "$($script:ProjectUrl)/storage/v1/object/authenticated/$([uri]::EscapeDataString($bucket.name))/$encodedPath"
                            Invoke-WebRequest -Method Get -Uri $downloadUri -Headers $headers -OutFile $target -TimeoutSec 180
                            $storageCount++
                        }
                    }
                    $offset += $items.Count
                } while ($items.Count -eq 1000)
            }
        }

        $counts = @{ authUsers = $users.Count; storageBuckets = $buckets.Count; storageObjects = $storageCount; databaseObjects = $dbObjects }
        Write-Manifest $work $counts
        Compress-Archive -Path (Join-Path $work 'database.dump'),(Join-Path $work 'database.toc.txt'),(Join-Path $work 'auth'),(Join-Path $work 'storage'),(Join-Path $work 'manifest.json') -DestinationPath $zip -CompressionLevel Optimal
        & $script:AgeExe -r $config.ageRecipient -o $final $zip 2>$null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $final)) { throw 'Criptografia do backup falhou.' }
        $cipherHash = Get-Sha256 $final
        & $script:AgeExe -d -i $script:IdentityPath -o $recovery $final 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Teste de descriptografia do backup falhou.' }
        Expand-Archive -LiteralPath $recovery -DestinationPath $extract
        Assert-Manifest $extract
        & (Join-Path $script:PgBin 'pg_restore.exe') --list (Join-Path $extract 'database.dump') 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'O dump recuperado nÃ£o passou na validaÃ§Ã£o pg_restore.' }
        $report = [ordered]@{ status = 'SUCCESS'; projectRef = $script:ProjectRef; completedAtUtc = [DateTime]::UtcNow.ToString('o'); encryptedFile = [IO.Path]::GetFileName($final); encryptedBytes = (Get-Item $final).Length; encryptedSha256 = $cipherHash; counts = $counts; recoveryValidation = 'PASSED' }
        $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding UTF8
        Write-Host "Backup completo validado: $final"
        Write-Host "RelatÃ³rio sem credenciais/dados pessoais: $reportPath"
    }
    catch {
        if (Test-Path -LiteralPath $final) { Remove-Item -LiteralPath $final -Force }
        $failure = [ordered]@{ status = 'FAILED'; projectRef = $script:ProjectRef; completedAtUtc = [DateTime]::UtcNow.ToString('o'); error = 'Falha em uma etapa; backup nÃ£o Ã© considerado vÃ¡lido.' }
        $failure | ConvertTo-Json | Set-Content -LiteralPath $reportPath -Encoding UTF8
        Write-Error 'Backup interrompido. Detalhes sensÃ­veis foram omitidos; consulte o relatÃ³rio de falha.'
        exit 1
    }
    finally {
        if ($hadPgPassFile) { $env:PGPASSFILE = $previousPgPassFile } else { Remove-Item Env:\PGPASSFILE -ErrorAction SilentlyContinue }
        if ($hadSslMode) { $env:PGSSLMODE = $previousSslMode } else { Remove-Item Env:\PGSSLMODE -ErrorAction SilentlyContinue }
        $dbPassword = $null; $apiKey = $null
        $cleanupFailed = $false
        try {
            if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop }
        } catch { $cleanupFailed = $true }
        if (Test-Path -LiteralPath $work) { $cleanupFailed = $true }
        if ($cleanupFailed) {
            Remove-Item -LiteralPath $final -Force -ErrorAction SilentlyContinue
            $cleanupReport = [ordered]@{ status = 'FAILED'; projectRef = $script:ProjectRef; completedAtUtc = [DateTime]::UtcNow.ToString('o'); error = 'Temporary cleanup failed; encrypted result invalidated.' }
            $cleanupReport | ConvertTo-Json | Set-Content -LiteralPath $reportPath -Encoding UTF8
            throw 'Temporary cleanup failed; the encrypted result was invalidated.'
        }
    }
}

if ($SelfTest) { Invoke-SelfTest; exit 0 }
if ($Configure) { Invoke-Configure; exit 0 }
Invoke-ProductionBackup
