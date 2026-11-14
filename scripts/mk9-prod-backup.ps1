[CmdletBinding()]
param(
    [switch]$Configure,
    [switch]$SelfTest,
    [switch]$TestAcl,
    [switch]$Diagnose,
    [switch]$ConfigureApiCredential,
    [switch]$ConfigureDatabaseEndpoint,
    [switch]$ConfigureDatabaseCredential
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
$script:CaCertPath = Join-Path $script:ConfigHome 'supabase-prod-ca-2021.crt'
$script:DbCredentialPath = Join-Path $script:ConfigHome 'database.credential.xml'
$script:ApiCredentialPath = Join-Path $script:ConfigHome 'service-role.credential.xml'
$script:IdentityPath = Join-Path $script:ConfigHome 'age-identity.txt'
$script:BackupRoot = Join-Path $script:ConfigHome 'Backups'

function Protect-PrivateDirectory([string]$Path) {
    $directory = [System.IO.DirectoryInfo]::new([IO.Path]::GetFullPath($Path))
    $directory.Create()
    $directory.Refresh()
    if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'The private directory cannot be a reparse point.'
    }

    # Load and persist only the DACL. A fresh DirectorySecurity is marked as
    # modifying owner/group/audit sections too, which makes Set-Acl demand
    # SeSecurityPrivilege even though this operation only needs access rules.
    $acl = $directory.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) {
        $acl.RemoveAccessRuleSpecific($existingRule)
    }
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in @($currentSid, $systemSid)) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::Modify,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    $directory.SetAccessControl($acl)
}

function Invoke-AclRegressionTest {
    $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('mk9-acl-regression-' + [guid]::NewGuid().ToString('N'))
    try {
        $directory = [System.IO.DirectoryInfo]::new($testRoot)
        $directory.Create()
        $ownerBefore = $directory.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Owner).GetOwner([System.Security.Principal.SecurityIdentifier]).Value
        Protect-PrivateDirectory $testRoot
        $security = $directory.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
        if (-not $security.AreAccessRulesProtected) { throw 'DACL inheritance was not disabled.' }
        $rules = @($security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        $expectedSids = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18') | Sort-Object -Unique
        $actualSids = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
        if (Compare-Object $expectedSids $actualSids) { throw 'The protected DACL contains unexpected or missing principals.' }
        $expectedRights = [System.Security.AccessControl.FileSystemRights]::Modify -bor [System.Security.AccessControl.FileSystemRights]::Synchronize
        if (@($rules | Where-Object { $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $_.FileSystemRights -ne $expectedRights }).Count -ne 0) {
            throw 'Unexpected access rule in the protected DACL.'
        }
        $ownerAfter = $directory.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Owner).GetOwner([System.Security.Principal.SecurityIdentifier]).Value
        if ($ownerAfter -ne $ownerBefore) { throw 'The ACL operation changed the directory owner.' }

        $childPath = Join-Path $testRoot 'child'
        [System.IO.Directory]::CreateDirectory($childPath) | Out-Null
        $childAcl = (Get-Item -LiteralPath $childPath).GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
        $childSids = @($childAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
        if (Compare-Object $expectedSids $childSids) { throw 'The protected DACL did not inherit to a child directory.' }

        $blockedPath = Join-Path $testRoot 'not-a-directory'
        Set-Content -LiteralPath $blockedPath -Value 'synthetic fixture' -Encoding ASCII
        $failedClosed = $false
        try { Protect-PrivateDirectory $blockedPath } catch { $failedClosed = $true }
        if (-not $failedClosed) { throw 'ACL failure did not stop private-directory setup.' }
        Write-Host 'ACL regression test passed: DACL-only update, user + SYSTEM, owner unchanged, inheritance protected.'
    }
    finally {
        if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction Stop }
        if (Test-Path -LiteralPath $testRoot) { throw 'ACL regression test cleanup failed.' }
    }
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
    $dbPassword = Read-Host 'Senha do usuario PostgreSQL direto postgres' -AsSecureString
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
    $dbCredential = New-Object System.Management.Automation.PSCredential('postgres', $dbPassword)
    $apiCredential = New-Object System.Management.Automation.PSCredential('service_role', $serviceKey)
    $dbCredential | Export-Clixml -LiteralPath $script:DbCredentialPath -Force
    $apiCredential | Export-Clixml -LiteralPath $script:ApiCredentialPath -Force
    $config = [ordered]@{ projectRef = $script:ProjectRef; projectUrl = $script:ProjectUrl; ageRecipient = $recipient; sslRootCertPath = $script:CaCertPath; databaseConnectionMode = 'direct' }
    $config | ConvertTo-Json | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
    Write-Host "ConfiguraÃ§Ã£o protegida salva em $script:ConfigHome"
}

function Invoke-ConfigureApiCredential {
    Protect-PrivateDirectory $script:ConfigHome
    $secureApiKey = Read-Host 'Current Supabase service_role key (secure input; no server change)' -AsSecureString
    $apiKeyForValidation = (New-Object System.Net.NetworkCredential('', $secureApiKey)).Password
    if (-not (Test-ApiHeaderValue $apiKeyForValidation)) {
        $apiKeyForValidation = $null
        throw 'The local API credential contains invalid header characters; it was not saved.'
    }
    $apiCredential = New-Object System.Management.Automation.PSCredential('service_role', $secureApiKey)
    $apiCredential | Export-Clixml -LiteralPath $script:ApiCredentialPath -Force
    $apiKeyForValidation = $null
    Write-Host 'The local DPAPI service_role credential was updated. Supabase was not contacted.'
}

function Save-DpapiDatabaseCredential([string]$Path, [string]$UserName, [Security.SecureString]$Password, [switch]$SimulatePostReplaceFailure) {
    if ($Password.Length -eq 0) { throw 'DATABASE_PASSWORD_EMPTY' }
    $parent = Split-Path -Parent $Path
    Protect-PrivateDirectory $parent
    $temporaryPath = Join-Path $parent ('.database-credential-' + [guid]::NewGuid().ToString('N') + '.xml')
    $backupPath = Join-Path $parent ('.database-credential-rollback-' + [guid]::NewGuid().ToString('N') + '.xml')
    $failedReplacementPath = Join-Path $parent ('.database-credential-failed-' + [guid]::NewGuid().ToString('N') + '.xml')
    $hadOriginal = Test-Path -LiteralPath $Path -PathType Leaf
    $replacementComplete = $false
    try {
        $credential = New-Object System.Management.Automation.PSCredential($UserName, $Password)
        $credential | Export-Clixml -LiteralPath $temporaryPath -ErrorAction Stop
        $roundTrip = Import-Clixml -LiteralPath $temporaryPath -ErrorAction Stop
        if ($roundTrip.UserName -ne $UserName -or $roundTrip.Password.Length -ne $Password.Length) { throw 'DATABASE_CREDENTIAL_DPAPI_VERIFY_FAILED' }
        if ($hadOriginal) {
            [IO.File]::Replace($temporaryPath, $Path, $backupPath)
            try {
                if ($SimulatePostReplaceFailure) { throw 'SYNTHETIC_POST_REPLACE_FAILURE' }
                $installed = Import-Clixml -LiteralPath $Path -ErrorAction Stop
                if ($installed.UserName -ne $UserName -or $installed.Password.Length -ne $Password.Length) { throw 'DATABASE_CREDENTIAL_INSTALL_VERIFY_FAILED' }
                $replacementComplete = $true
            } catch {
                if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
                    [IO.File]::Replace($backupPath, $Path, $failedReplacementPath)
                    if (Test-Path -LiteralPath $failedReplacementPath -PathType Leaf) { Remove-Item -LiteralPath $failedReplacementPath -Force -ErrorAction Stop }
                }
                throw
            }
        } else {
            [IO.File]::Move($temporaryPath, $Path)
            try {
                if ($SimulatePostReplaceFailure) { throw 'SYNTHETIC_POST_REPLACE_FAILURE' }
                $installed = Import-Clixml -LiteralPath $Path -ErrorAction Stop
                if ($installed.UserName -ne $UserName -or $installed.Password.Length -ne $Password.Length) { throw 'DATABASE_CREDENTIAL_INSTALL_VERIFY_FAILED' }
                $replacementComplete = $true
            } catch {
                if (Test-Path -LiteralPath $Path -PathType Leaf) { Remove-Item -LiteralPath $Path -Force -ErrorAction Stop }
                throw
            }
        }
        if ($replacementComplete -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) { Remove-Item -LiteralPath $backupPath -Force -ErrorAction Stop }
    } finally {
        $credential = $null
        $roundTrip = $null
        $installed = $null
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue }
    }
}

function Invoke-ConfigureDatabaseCredential {
    foreach ($requiredPath in @($script:ConfigPath, $script:DbCredentialPath)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw 'LOCAL_DATABASE_CONFIGURATION_MISSING' }
    }
    $config = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
    if ($config.projectRef -ne $script:ProjectRef -or $config.projectUrl -ne $script:ProjectUrl) { throw 'LOCAL_PROJECT_REF_MISMATCH' }
    $connection = Get-DatabaseConnectionSettings $config
    $securePassword = $null
    try {
        $securePassword = Read-Host 'Current PostgreSQL database password (secure input; no server change)' -AsSecureString
        Save-DpapiDatabaseCredential $script:DbCredentialPath $connection.User $securePassword
        Write-Host 'The local DPAPI PostgreSQL credential was updated for the configured connection mode. Supabase was not contacted.'
    } finally {
        if ($null -ne $securePassword) { $securePassword.Dispose() }
    }
}

function Get-DatabaseConnectionSettings($Config) {
    $mode = if ($Config.PSObject.Properties.Name -contains 'databaseConnectionMode') { [string]$Config.databaseConnectionMode } else { 'direct' }
    if ($mode -eq 'direct') {
        return [pscustomobject]@{ Mode = 'direct'; Host = "db.$($script:ProjectRef).supabase.co"; Port = 5432; User = 'postgres' }
    }
    if ($mode -eq 'session-pooler') {
        if ($Config.PSObject.Properties.Name -notcontains 'poolerHost' -or [string]$Config.poolerHost -notmatch '^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$') {
            throw 'PG_POOLER_HOST_NOT_CONFIGURED'
        }
        return [pscustomobject]@{ Mode = 'session-pooler'; Host = [string]$Config.poolerHost; Port = 5432; User = "postgres.$($script:ProjectRef)" }
    }
    throw 'PG_CONNECTION_MODE_INVALID'
}

function Assert-SupabaseCaCertificate([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'PG_TLS_ROOT_CERT_MISSING' }
    try {
        $pem = Get-Content -LiteralPath $Path -Raw
        $match = [regex]::Match($pem, '-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\r\n]+)\s*-----END CERTIFICATE-----')
        if (-not $match.Success) { throw 'PG_TLS_ROOT_CERT_INVALID' }
        $der = [Convert]::FromBase64String(($match.Groups[1].Value -replace '\s', ''))
        $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($der)
        $now = [DateTime]::UtcNow
        $isCa = $false
        foreach ($extension in $certificate.Extensions) {
            if ($extension -is [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension] -and $extension.CertificateAuthority) { $isCa = $true }
        }
        if (-not $isCa -or $certificate.Subject -notmatch '(?i)supabase' -or $certificate.NotBefore.ToUniversalTime() -gt $now -or $certificate.NotAfter.ToUniversalTime() -lt $now) { throw 'PG_TLS_ROOT_CERT_INVALID' }
    } catch {
        if ($_.Exception.Message -match '^PG_TLS_ROOT_CERT_[A-Z_]+$') { throw }
        throw 'PG_TLS_ROOT_CERT_INVALID'
    }
}

function Install-LocalSupabaseCaCertificate([string]$SourcePath) {
    if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) { throw 'PG_TLS_ROOT_CERT_MISSING' }
    Assert-SupabaseCaCertificate $SourcePath
    if (Test-Path -LiteralPath $script:CaCertPath -PathType Leaf) {
        Assert-SupabaseCaCertificate $script:CaCertPath
    } else {
        Copy-Item -LiteralPath $SourcePath -Destination $script:CaCertPath
    }
    return $script:CaCertPath
}

function Get-DatabaseTlsSettings($Config) {
    $path = if ($Config.PSObject.Properties.Name -contains 'sslRootCertPath') { [string]$Config.sslRootCertPath } else { $script:CaCertPath }
    Assert-SupabaseCaCertificate $path
    return [IO.Path]::GetFullPath($path)
}

function Invoke-ConfigureDatabaseEndpoint {
    if (-not (Test-Path -LiteralPath $script:ConfigPath -PathType Leaf)) { throw 'Run -Configure before selecting a database endpoint.' }
    Protect-PrivateDirectory $script:ConfigHome
    $config = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
    if ($config.projectRef -ne $script:ProjectRef -or $config.projectUrl -ne $script:ProjectUrl) { throw 'LOCAL_PROJECT_REF_MISMATCH' }
    $mode = (Read-Host 'Connection mode: direct or session-pooler').Trim().ToLowerInvariant()
    if ($mode -eq 'direct') {
        $config | Add-Member -NotePropertyName databaseConnectionMode -NotePropertyValue 'direct' -Force
        $poolerHost = (Read-Host 'Optional exact Session pooler hostname for IPv4 fallback (blank to skip)').Trim().ToLowerInvariant()
        if ($poolerHost) {
            if ($poolerHost -notmatch '^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$') { throw 'PG_POOLER_HOST_INVALID' }
            $config | Add-Member -NotePropertyName poolerHost -NotePropertyValue $poolerHost -Force
        } else {
            $config.PSObject.Properties.Remove('poolerHost')
        }
    } elseif ($mode -eq 'session-pooler') {
        $poolerHost = (Read-Host 'Paste the exact Session pooler hostname from Supabase Connect').Trim().ToLowerInvariant()
        if ($poolerHost -notmatch '^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$') { throw 'PG_POOLER_HOST_INVALID' }
        $config | Add-Member -NotePropertyName databaseConnectionMode -NotePropertyValue 'session-pooler' -Force
        $config | Add-Member -NotePropertyName poolerHost -NotePropertyValue $poolerHost -Force
    } else { throw 'PG_CONNECTION_MODE_INVALID' }
    $caSource = (Read-Host 'Path to the Supabase CA certificate downloaded from Database Settings').Trim().Trim('"')
    $config | Add-Member -NotePropertyName sslRootCertPath -NotePropertyValue (Install-LocalSupabaseCaCertificate $caSource) -Force
    $config | ConvertTo-Json | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
    Write-Host 'Database endpoint mode saved in the private local configuration.'
}

function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-PgDumpCompatibility($Connection, [string]$Directory, [string]$Prefix = 'pgdump-compat') {
    $dumpPath = Join-Path $Directory ($Prefix + '.dump')
    $dumpResult = Invoke-CapturedNative (Join-Path $script:PgBin 'pg_dump.exe') @('--schema-only', '-h', $Connection.Host, '-p', [string]$Connection.Port, '-U', $Connection.User, '-d', 'postgres', '-Fc', '-f', $dumpPath)
    if ($dumpResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $dumpPath -PathType Leaf) -or (Get-Item -LiteralPath $dumpPath).Length -eq 0) {
        if (Test-Path -LiteralPath $dumpPath) { Remove-Item -LiteralPath $dumpPath -Force -ErrorAction SilentlyContinue }
        return 'PGDUMP_COMPATIBILITY_PROBE_FAILED'
    }
    $tocResult = Invoke-CapturedNative (Join-Path $script:PgBin 'pg_restore.exe') @('--list', $dumpPath)
    Remove-Item -LiteralPath $dumpPath -Force -ErrorAction SilentlyContinue
    if ($tocResult.ExitCode -ne 0) { return 'PGDUMP_COMPATIBILITY_TOC_FAILED' }
    return 'PGDUMP_CONNECTION_COMPATIBLE'
}

function Write-FailureReport([string]$Path, [string]$Stage, [string]$FailureType) {
    $failure = [ordered]@{
        status = 'FAILED'
        projectRef = $script:ProjectRef
        completedAtUtc = [DateTime]::UtcNow.ToString('o')
        failedStage = $Stage
        failureType = $FailureType
        error = 'Falha em uma etapa; backup nao e considerado valido.'
    }
    $failure | ConvertTo-Json | Set-Content -LiteralPath $Path -Encoding UTF8
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
        $failureReportPath = Join-Path $testRoot 'synthetic-failure.report.json'
        Write-FailureReport $failureReportPath 'synthetic-stage' 'SyntheticException'
        $failureReport = Get-Content -LiteralPath $failureReportPath -Raw | ConvertFrom-Json
        if ($failureReport.failedStage -ne 'synthetic-stage' -or $failureReport.failureType -ne 'SyntheticException' -or $failureReport.PSObject.Properties.Name -contains 'message') {
            throw 'Failure-report regression test failed.'
        }
        if ((Get-PostgresDiagnosticCode 2 'no response') -ne 'PG_SERVER_UNREACHABLE' -or
            (Get-PostgresDiagnosticCode 1 'password authentication failed for user [redacted]') -ne 'PG_PASSWORD_REJECTED' -or
            (Get-PostgresDiagnosticCode 1 'role [redacted] does not exist') -ne 'PG_ROLE_NOT_FOUND' -or
            (Get-PostgresDiagnosticCode 1 'database [redacted] does not exist') -ne 'PG_DATABASE_NOT_FOUND' -or
            (Get-PostgresDiagnosticCode 2 'fe_sendauth: no password supplied') -ne 'PG_PASSWORD_FILE_OR_DELIVERY_ERROR') {
            throw 'PostgreSQL diagnostic-code regression test failed.'
        }
        if ((Escape-PgPass 'synthetic:colon\slash') -cne 'synthetic\:colon\\slash' -or (Escape-PgPass 'synthetic-ascii') -cne 'synthetic-ascii') {
            throw 'PostgreSQL password-file escaping regression test failed.'
        }
        $fakeApiError = [pscustomobject]@{ Exception = [ArgumentException]::new('invalid header') }
        if ((Get-SafeApiDiagnosticCode $fakeApiError) -ne 'SUPABASE_API_HEADER_VALUE_INVALID' -or (Test-ApiHeaderValue "bad`nkey") -or -not (Test-ApiHeaderValue 'synthetic-api-key_123')) { throw 'API diagnostic-code regression test failed.' }
        $directSettings = Get-DatabaseConnectionSettings ([pscustomobject]@{ projectRef = $script:ProjectRef })
        $poolerSettings = Get-DatabaseConnectionSettings ([pscustomobject]@{ databaseConnectionMode = 'session-pooler'; poolerHost = 'aws-1-sa-east-1.pooler.supabase.com' })
        $badPoolerRejected = $false
        try { Get-DatabaseConnectionSettings ([pscustomobject]@{ databaseConnectionMode = 'session-pooler'; poolerHost = 'untrusted.example.com' }) | Out-Null } catch { $badPoolerRejected = $true }
        if ($directSettings.Host -ne "db.$($script:ProjectRef).supabase.co" -or $directSettings.User -ne 'postgres' -or $poolerSettings.User -ne "postgres.$($script:ProjectRef)" -or $poolerSettings.Port -ne 5432 -or -not $badPoolerRejected) { throw 'Database endpoint configuration regression test failed.' }
        $invalidCa = Join-Path $testRoot 'invalid-ca.crt'
        Set-Content -LiteralPath $invalidCa -Value 'synthetic-invalid-certificate' -Encoding ASCII
        $invalidCaRejected = $false
        try { Assert-SupabaseCaCertificate $invalidCa } catch { $invalidCaRejected = $_.Exception.Message -eq 'PG_TLS_ROOT_CERT_INVALID' }
        if (-not $invalidCaRejected) { throw 'Invalid TLS CA was not rejected.' }
        $fixturePassword = ConvertTo-SecureString 'synthetic-db-password' -AsPlainText -Force
        $fixtureCredentialPath = Join-Path $testRoot 'database.credential.xml'
        Save-DpapiDatabaseCredential $fixtureCredentialPath 'postgres.xzmbesqhxcnuokjwrbnw' $fixturePassword
        $fixtureCredential = Import-Clixml -LiteralPath $fixtureCredentialPath
        if ($fixtureCredential.UserName -ne 'postgres.xzmbesqhxcnuokjwrbnw' -or $fixtureCredential.Password.Length -ne $fixturePassword.Length) { throw 'DPAPI database credential regression test failed.' }
        $legacyReplaceInput = Join-Path $testRoot 'legacy-replace-input.xml'
        Set-Content -LiteralPath $legacyReplaceInput -Value 'synthetic-invalid-replacement' -Encoding ASCII
        $legacyNullBackupRejected = $false
        try { [IO.File]::Replace($legacyReplaceInput, $fixtureCredentialPath, $null) } catch { $legacyNullBackupRejected = $true }
        if (-not $legacyNullBackupRejected) { throw 'Regression fixture did not reproduce File.Replace with a null backup path.' }
        $afterLegacyFailure = Import-Clixml -LiteralPath $fixtureCredentialPath
        if ($afterLegacyFailure.UserName -ne 'postgres.xzmbesqhxcnuokjwrbnw' -or $afterLegacyFailure.Password.Length -ne $fixturePassword.Length) { throw 'Legacy replacement failure changed the previous DPAPI credential.' }

        $updatedFixturePassword = ConvertTo-SecureString 'synthetic-db-password-updated' -AsPlainText -Force
        $postReplaceFailureRecovered = $false
        try { Save-DpapiDatabaseCredential $fixtureCredentialPath 'postgres.xzmbesqhxcnuokjwrbnw' $updatedFixturePassword -SimulatePostReplaceFailure } catch { $postReplaceFailureRecovered = $_.Exception.Message -eq 'SYNTHETIC_POST_REPLACE_FAILURE' }
        if (-not $postReplaceFailureRecovered) { throw 'Post-replacement failure injection did not trigger.' }
        $afterRollback = Import-Clixml -LiteralPath $fixtureCredentialPath
        if ($afterRollback.UserName -ne 'postgres.xzmbesqhxcnuokjwrbnw' -or $afterRollback.GetNetworkCredential().Password -ne 'synthetic-db-password') { throw 'Rollback did not restore the prior DPAPI credential.' }
        if (@(Get-ChildItem -LiteralPath $testRoot -File -Filter '.database-credential-*').Count -ne 0) { throw 'Failed DPAPI replacement left transaction files.' }

        Save-DpapiDatabaseCredential $fixtureCredentialPath 'postgres.xzmbesqhxcnuokjwrbnw' $updatedFixturePassword
        $afterSuccess = Import-Clixml -LiteralPath $fixtureCredentialPath
        if ($afterSuccess.UserName -ne 'postgres.xzmbesqhxcnuokjwrbnw' -or $afterSuccess.GetNetworkCredential().Password -ne 'synthetic-db-password-updated') { throw 'Successful DPAPI credential replacement failed.' }
        if (@(Get-ChildItem -LiteralPath $testRoot -File -Filter '.database-credential-*').Count -ne 0) { throw 'DPAPI credential transaction left temporary files.' }
        $fixturePassword.Dispose()
        $updatedFixturePassword.Dispose()
        $fixtureCredential = $null
        Write-Host 'SELF-TEST OK: age, manifesto, integridade, DPAPI atomic replacement, rollback and synthetic fixtures.'
    }
    finally {
        if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
        if (Test-Path -LiteralPath $testRoot) { throw 'Falha na limpeza dos temporÃ¡rios do self-test.' }
    }
}

function Escape-PgPass([string]$Value) { $Value.Replace('\', '\\').Replace(':', '\:') }

function Get-PostgresDiagnosticCode([int]$ExitCode, [string]$Output) {
    if ($Output -match '(?i)password authentication failed|authentication failed') { return 'PG_PASSWORD_REJECTED' }
    if ($Output -match '(?i)role .* does not exist') { return 'PG_ROLE_NOT_FOUND' }
    if ($Output -match '(?i)database .* does not exist') { return 'PG_DATABASE_NOT_FOUND' }
    if ($Output -match '(?i)no password supplied|password file .* (?:not found|invalid)|could not open password file') { return 'PG_PASSWORD_FILE_OR_DELIVERY_ERROR' }
    if ($Output -match '(?i)invalid connection option|missing .* in connection string|invalid port number') { return 'PG_CONNECTION_CONFIGURATION_ERROR' }
    if ($Output -match '(?i)could not translate host name|name or service not known|no such host') { return 'PG_DNS_RESOLUTION_FAILED' }
    if ($Output -match '(?i)ssl|tls|certificate') { return 'PG_TLS_NEGOTIATION_FAILED' }
    if ($ExitCode -eq 2 -or $Output -match '(?i)timeout|no response|could not connect to server|connection refused') { return 'PG_SERVER_UNREACHABLE' }
    return "PG_PREFLIGHT_EXIT_$ExitCode"
}

function Get-SafeApiDiagnosticCode($ErrorRecord) {
    $message = [string]$ErrorRecord.Exception.Message
    if ($message -match '(?i)header|carriage return|newline|line break') { return 'SUPABASE_API_HEADER_VALUE_INVALID' }
    if ($message -match '(?i)uri|url') { return 'SUPABASE_API_URL_INVALID' }
    $status = $null
    try { $status = [int]$ErrorRecord.Exception.Response.StatusCode } catch { }
    if ($status -eq 401 -or $status -eq 403) { return 'SUPABASE_API_CREDENTIAL_REJECTED' }
    if ($status -ge 500) { return 'SUPABASE_API_SERVER_ERROR' }
    if ($status -eq 404) { return 'SUPABASE_API_ENDPOINT_NOT_FOUND' }
    $webStatus = ''
    try { $webStatus = [string]$ErrorRecord.Exception.Status } catch { }
    if ($webStatus -match 'NameResolutionFailure') { return 'SUPABASE_API_DNS_FAILED' }
    if ($webStatus -match 'ConnectFailure|Timeout') { return 'SUPABASE_API_UNREACHABLE' }
    if ($ErrorRecord.Exception -is [ArgumentException]) { return 'SUPABASE_API_ARGUMENT_REJECTED' }
    return 'SUPABASE_API_REQUEST_FAILED'
}

function Test-ApiHeaderValue([string]$Value) {
    return (-not [string]::IsNullOrWhiteSpace($Value) -and $Value.Length -le 4096 -and $Value -notmatch '[^\x21-\x7E]')
}

function Invoke-CapturedNative([string]$Executable, [string[]]$Arguments) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $Executable @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
        $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
        return [pscustomobject]@{ ExitCode = $exitCode; Output = $text }
    }
    finally { $ErrorActionPreference = $previousPreference }
}

function Test-PrivateDirectoryAcl([string]$Path) {
    $directory = [System.IO.DirectoryInfo]::new([IO.Path]::GetFullPath($Path))
    if (-not $directory.Exists) { throw 'PRIVATE_DIRECTORY_MISSING' }
    $security = $directory.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    if (-not $security.AreAccessRulesProtected) { throw 'PRIVATE_DIRECTORY_DACL_INHERITS' }
    $rules = @($security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    $expectedSids = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18') | Sort-Object -Unique
    $actualSids = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
    if (Compare-Object $expectedSids $actualSids) { throw 'PRIVATE_DIRECTORY_PRINCIPALS_INVALID' }
    $expectedRights = [System.Security.AccessControl.FileSystemRights]::Modify -bor [System.Security.AccessControl.FileSystemRights]::Synchronize
    if (@($rules | Where-Object { $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $_.FileSystemRights -ne $expectedRights }).Count -ne 0) {
        throw 'PRIVATE_DIRECTORY_RIGHTS_INVALID'
    }
}

function Add-DiagnosticResult([Collections.Generic.List[object]]$Results, [string]$Stage, [string]$FailureType, [string]$Code) {
    $Results.Add([ordered]@{ stage = $Stage; failureType = $FailureType; code = $Code })
}

function Invoke-ProductionDiagnostics {
    $results = [Collections.Generic.List[object]]::new()
    $config = $null
    $storedDbCredential = $null
    $apiCredential = $null
    try {
        Assert-Tools
        Add-DiagnosticResult $results 'local-dependencies' 'None' 'DEPENDENCIES_OK'
    } catch {
        Add-DiagnosticResult $results 'local-dependencies' $_.Exception.GetType().Name 'DEPENDENCY_CHECK_FAILED'
    }

    try {
        foreach ($path in @($script:ConfigPath, $script:DbCredentialPath, $script:ApiCredentialPath, $script:IdentityPath)) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'LOCAL_CONFIGURATION_MISSING' }
        }
        $config = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
        if ($config.projectRef -ne $script:ProjectRef -or $config.projectUrl -ne $script:ProjectUrl) { throw 'LOCAL_PROJECT_REF_MISMATCH' }
        $storedDbCredential = Import-Clixml -LiteralPath $script:DbCredentialPath
        $apiCredential = Import-Clixml -LiteralPath $script:ApiCredentialPath
        if ($storedDbCredential.UserName -notin @('postgres', "postgres.$($script:ProjectRef)") -or $storedDbCredential.Password.Length -eq 0) { throw 'LOCAL_DATABASE_CREDENTIAL_INVALID' }
        if ($apiCredential.UserName -ne 'service_role' -or $apiCredential.Password.Length -eq 0) { throw 'LOCAL_API_CREDENTIAL_INVALID' }
        Add-DiagnosticResult $results 'local-dpapi-configuration' 'None' 'DPAPI_CREDENTIALS_OK'
        Add-DiagnosticResult $results 'project-identity' 'None' 'PRODUCTION_PROJECT_REF_MATCH'
    } catch {
        $safeCode = if ($_.Exception.Message -match '^LOCAL_[A-Z_]+$') { $_.Exception.Message } else { 'LOCAL_CONFIGURATION_CHECK_FAILED' }
        Add-DiagnosticResult $results 'local-dpapi-configuration' $_.Exception.GetType().Name $safeCode
    }

    try {
        $derived = (& $script:AgeKeygenExe -y $script:IdentityPath 2>$null | Select-Object -Last 1).Trim()
        if ($LASTEXITCODE -ne 0 -or $derived -ne $config.ageRecipient) { throw 'AGE_RECIPIENT_MISMATCH' }
        Add-DiagnosticResult $results 'age-key-match' 'None' 'AGE_RECIPIENT_MATCH'
    } catch {
        Add-DiagnosticResult $results 'age-key-match' $_.Exception.GetType().Name 'AGE_KEY_CHECK_FAILED'
    }

    foreach ($pathInfo in @(@{ Stage = 'config-directory-acl'; Path = $script:ConfigHome }, @{ Stage = 'backup-directory-acl'; Path = $script:BackupRoot })) {
        try {
            Test-PrivateDirectoryAcl $pathInfo.Path
            Add-DiagnosticResult $results $pathInfo.Stage 'None' 'PRIVATE_DACL_OK'
        } catch {
            $safeCode = if ($_.Exception.Message -match '^PRIVATE_[A-Z_]+$') { $_.Exception.Message } else { 'PRIVATE_DACL_CHECK_FAILED' }
            Add-DiagnosticResult $results $pathInfo.Stage $_.Exception.GetType().Name $safeCode
        }
    }

    $diagWork = Join-Path $script:ConfigHome ('.diagnostic-' + [guid]::NewGuid().ToString('N'))
    $diagnosticReportPath = $null
    $hadPgPassFile = Test-Path Env:\PGPASSFILE
    $previousPgPassFile = $env:PGPASSFILE
    $hadSslMode = Test-Path Env:\PGSSLMODE
    $previousSslMode = $env:PGSSLMODE
    $hadSslRootCert = Test-Path Env:\PGSSLROOTCERT
    $previousSslRootCert = $env:PGSSLROOTCERT
    $sslCertPath = $null
    try {
        $sslCertPath = Get-DatabaseTlsSettings $config
        Add-DiagnosticResult $results 'postgresql-tls-root-certificate' 'None' 'PG_TLS_ROOT_CERT_VALID'
    } catch {
        $tlsCode = if ($_.Exception.Message -match '^PG_TLS_ROOT_CERT_[A-Z_]+$') { $_.Exception.Message } else { 'PG_TLS_ROOT_CERT_INVALID' }
        Add-DiagnosticResult $results 'postgresql-tls-root-certificate' $_.Exception.GetType().Name $tlsCode
    }
    try {
        if ($null -ne $storedDbCredential -and $null -ne $apiCredential) {
            Protect-PrivateDirectory $diagWork
            $pgpass = Join-Path $diagWork 'pgpass.conf'
            $dbPassword = $storedDbCredential.GetNetworkCredential().Password
            $connection = Get-DatabaseConnectionSettings $config
            if ($null -eq $sslCertPath) {
                Add-DiagnosticResult $results 'postgresql-readiness' 'Skipped' 'PG_TLS_ROOT_CERT_MISSING_OR_INVALID'
                Add-DiagnosticResult $results 'postgresql-project-identity' 'Skipped' 'PG_TLS_ROOT_CERT_MISSING_OR_INVALID'
            } else {
                $env:PGPASSFILE = $pgpass
                $env:PGSSLMODE = 'verify-full'
                $env:PGSSLROOTCERT = $sslCertPath
                $pgpassLine = "$($connection.Host):$($connection.Port):postgres:$($connection.User):$((Escape-PgPass $dbPassword))"
                Set-Content -LiteralPath $pgpass -Value $pgpassLine -Encoding ASCII

                $query = "select current_database() || '|' || current_user || '|' || current_setting('server_version_num')"
                $pgReady = Invoke-CapturedNative (Join-Path $script:PgBin 'pg_isready.exe') @('-h', $connection.Host, '-p', [string]$connection.Port, '-d', 'postgres', '-U', $connection.User, '-t', '8')
            if ($pgReady.ExitCode -eq 0) {
                Add-DiagnosticResult $results 'postgresql-readiness' 'None' 'PG_SERVER_ACCEPTING_CONNECTIONS'
                $pgIdentity = Invoke-CapturedNative (Join-Path $script:PgBin 'psql.exe') @('-X', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1', '-h', $connection.Host, '-p', [string]$connection.Port, '-d', 'postgres', '-U', $connection.User, '-c', $query)
                if ($pgIdentity.ExitCode -eq 0) {
                    $identityParts = ($pgIdentity.Output.Trim() -split '\|')
                    if ($identityParts.Count -eq 3 -and $identityParts[0] -eq 'postgres' -and $identityParts[1] -eq 'postgres' -and $identityParts[2] -match '^17\d+$') {
                        Add-DiagnosticResult $results 'postgresql-project-identity' 'None' 'PRODUCTION_POSTGRES_17_CONFIRMED'
                        if ($connection.Mode -eq 'session-pooler') {
                            $compatibilityCode = Test-PgDumpCompatibility $connection $diagWork 'session-pooler-pgdump-compat'
                            if ($compatibilityCode -eq 'PGDUMP_CONNECTION_COMPATIBLE') {
                                Add-DiagnosticResult $results 'pg-dump-session-pooler-compatibility' 'None' 'PGDUMP_SESSION_POOLER_COMPATIBLE'
                            } else {
                                Add-DiagnosticResult $results 'pg-dump-session-pooler-compatibility' 'PostgreSQLClientError' $compatibilityCode
                            }
                        }
                    } else {
                        Add-DiagnosticResult $results 'postgresql-project-identity' 'IdentityMismatch' 'PG_DATABASE_ROLE_OR_VERSION_MISMATCH'
                    }
                } else {
                    Add-DiagnosticResult $results 'postgresql-project-identity' 'PostgreSQLClientError' (Get-PostgresDiagnosticCode $pgIdentity.ExitCode $pgIdentity.Output)
                }
            } else {
                Add-DiagnosticResult $results 'postgresql-readiness' 'PostgreSQLClientError' (Get-PostgresDiagnosticCode $pgReady.ExitCode $pgReady.Output)
                Add-DiagnosticResult $results 'postgresql-project-identity' 'NotRun' 'PG_READINESS_FAILED'
                if ($connection.Mode -eq 'direct' -and $config.PSObject.Properties.Name -contains 'poolerHost') {
                    $poolerConfig = [pscustomobject]@{ databaseConnectionMode = 'session-pooler'; poolerHost = $config.poolerHost }
                    $pooler = Get-DatabaseConnectionSettings $poolerConfig
                    $poolerPgPassLine = "$($pooler.Host):$($pooler.Port):postgres:$($pooler.User):$((Escape-PgPass $dbPassword))"
                    Add-Content -LiteralPath $pgpass -Value $poolerPgPassLine -Encoding ASCII
                    $poolerReady = Invoke-CapturedNative (Join-Path $script:PgBin 'pg_isready.exe') @('-h', $pooler.Host, '-p', [string]$pooler.Port, '-d', 'postgres', '-U', $pooler.User, '-t', '8')
                    if ($poolerReady.ExitCode -eq 0) {
                        Add-DiagnosticResult $results 'postgresql-pooler-readiness' 'None' 'PG_POOLER_ACCEPTING_CONNECTIONS'
                        $poolerIdentity = Invoke-CapturedNative (Join-Path $script:PgBin 'psql.exe') @('-X', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1', '-h', $pooler.Host, '-p', [string]$pooler.Port, '-d', 'postgres', '-U', $pooler.User, '-c', $query)
                        if ($poolerIdentity.ExitCode -eq 0) {
                            $identityParts = ($poolerIdentity.Output.Trim() -split '\|')
                            if ($identityParts.Count -eq 3 -and $identityParts[0] -eq 'postgres' -and $identityParts[1] -eq 'postgres' -and $identityParts[2] -match '^17\d+$') {
                                for ($resultIndex = $results.Count - 1; $resultIndex -ge 0; $resultIndex--) {
                                    if (($results[$resultIndex].stage -eq 'postgresql-readiness' -and $results[$resultIndex].code -eq 'PG_SERVER_UNREACHABLE') -or ($results[$resultIndex].stage -eq 'postgresql-project-identity' -and $results[$resultIndex].code -eq 'PG_READINESS_FAILED')) { $results.RemoveAt($resultIndex) }
                                }
                                Add-DiagnosticResult $results 'postgresql-project-identity' 'None' 'PRODUCTION_POSTGRES_17_CONFIRMED'
                                Add-DiagnosticResult $results 'postgresql-readiness' 'None' 'PG_POOLER_READ_ONLY_IDENTITY_CONFIRMED'
                                Add-DiagnosticResult $results 'postgresql-direct-readiness' 'Unavailable' 'PG_DIRECT_UNAVAILABLE_POOLER_VERIFIED'
                                $compatibilityCode = Test-PgDumpCompatibility $pooler $diagWork 'pooler-pgdump-compat'
                                if ($compatibilityCode -eq 'PGDUMP_CONNECTION_COMPATIBLE') { Add-DiagnosticResult $results 'pg-dump-session-pooler-compatibility' 'None' 'PGDUMP_SESSION_POOLER_COMPATIBLE' }
                                else { Add-DiagnosticResult $results 'pg-dump-session-pooler-compatibility' 'PostgreSQLClientError' $compatibilityCode }
                            } else {
                                Add-DiagnosticResult $results 'postgresql-project-identity' 'IdentityMismatch' 'PG_DATABASE_ROLE_OR_VERSION_MISMATCH'
                            }
                        } else {
                            Add-DiagnosticResult $results 'postgresql-project-identity' 'PostgreSQLClientError' (Get-PostgresDiagnosticCode $poolerIdentity.ExitCode $poolerIdentity.Output)
                        }
                    } else {
                        Add-DiagnosticResult $results 'postgresql-pooler-readiness' 'PostgreSQLClientError' (Get-PostgresDiagnosticCode $poolerReady.ExitCode $poolerReady.Output)
                    }
                } elseif ($connection.Mode -eq 'direct') {
                    Add-DiagnosticResult $results 'postgresql-pooler-readiness' 'NotConfigured' 'PG_POOLER_HOST_NOT_CONFIGURED'
                }
            }
            }
            $dbPassword = $null

            $apiKey = $apiCredential.GetNetworkCredential().Password
            if (-not (Test-ApiHeaderValue $apiKey)) {
                Add-DiagnosticResult $results 'supabase-api-credential-format' 'CredentialFormatError' 'API_CREDENTIAL_HEADER_INVALID'
                Add-DiagnosticResult $results 'supabase-auth-api' 'Skipped' 'API_CREDENTIAL_FORMAT_INVALID'
                Add-DiagnosticResult $results 'supabase-storage-api' 'Skipped' 'API_CREDENTIAL_FORMAT_INVALID'
            } else {
                $headers = @{ apikey = $apiKey; Authorization = "Bearer $apiKey" }
                try {
                    $authResponse = Invoke-RestMethod -Method Get -Uri "$($script:ProjectUrl)/auth/v1/admin/users?page=1`&per_page=1" -Headers $headers -TimeoutSec 30 -ErrorAction Stop
                    if ($null -ne $authResponse.PSObject.Properties['users']) { Add-DiagnosticResult $results 'supabase-auth-api' 'None' 'AUTH_READ_ONLY_REQUEST_OK' }
                    else { Add-DiagnosticResult $results 'supabase-auth-api' 'InvalidResponse' 'AUTH_RESPONSE_SHAPE_INVALID' }
                    $authResponse = $null
                } catch {
                    Add-DiagnosticResult $results 'supabase-auth-api' $_.Exception.GetType().Name (Get-SafeApiDiagnosticCode $_)
                }
                try {
                    $bucketResponse = @(Invoke-RestMethod -Method Get -Uri "$($script:ProjectUrl)/storage/v1/bucket" -Headers $headers -TimeoutSec 30 -ErrorAction Stop)
                    Add-DiagnosticResult $results 'supabase-storage-api' 'None' 'STORAGE_READ_ONLY_REQUEST_OK'
                    $bucketResponse = $null
                } catch {
                    Add-DiagnosticResult $results 'supabase-storage-api' $_.Exception.GetType().Name (Get-SafeApiDiagnosticCode $_)
                }
            }
            $apiKey = $null
        } else {
            Add-DiagnosticResult $results 'postgresql-readiness' 'Skipped' 'LOCAL_CREDENTIALS_UNAVAILABLE'
            Add-DiagnosticResult $results 'postgresql-project-identity' 'Skipped' 'LOCAL_CREDENTIALS_UNAVAILABLE'
            Add-DiagnosticResult $results 'supabase-auth-api' 'Skipped' 'LOCAL_CREDENTIALS_UNAVAILABLE'
            Add-DiagnosticResult $results 'supabase-storage-api' 'Skipped' 'LOCAL_CREDENTIALS_UNAVAILABLE'
        }
    } catch {
        Add-DiagnosticResult $results 'diagnostic-execution' $_.Exception.GetType().Name 'DIAGNOSTIC_SETUP_FAILED'
    }
    finally {
        if ($hadPgPassFile) { $env:PGPASSFILE = $previousPgPassFile } else { Remove-Item Env:\PGPASSFILE -ErrorAction SilentlyContinue }
        if ($hadSslMode) { $env:PGSSLMODE = $previousSslMode } else { Remove-Item Env:\PGSSLMODE -ErrorAction SilentlyContinue }
        if ($hadSslRootCert) { $env:PGSSLROOTCERT = $previousSslRootCert } else { Remove-Item Env:\PGSSLROOTCERT -ErrorAction SilentlyContinue }
        $dbPassword = $null; $apiKey = $null
        if (Test-Path -LiteralPath $diagWork) { Remove-Item -LiteralPath $diagWork -Recurse -Force -ErrorAction SilentlyContinue }
    }

    try {
        $diagnosticReportPath = Join-Path $script:BackupRoot ('diagnostic-' + [guid]::NewGuid().ToString('N') + '.json')
        @{ results = @($results) } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $diagnosticReportPath -Encoding UTF8
    } catch {
        Add-DiagnosticResult $results 'diagnostic-report' $_.Exception.GetType().Name 'LOCAL_REPORT_WRITE_FAILED'
    }
    foreach ($result in $results) { Write-Output "$($result.stage) $($result.failureType) $($result.code)" }
    if (@($results | Where-Object { $_.code -notmatch '(_OK|_MATCH|_CONFIRMED|_CONNECTIONS|_REQUEST_OK)$' -and $_.code -ne 'PG_DIRECT_UNAVAILABLE_POOLER_VERIFIED' }).Count -gt 0) { exit 2 }
    exit 0
}

function Invoke-ProductionBackup {
    Assert-Tools
    foreach ($path in @($script:ConfigPath, $script:DbCredentialPath, $script:ApiCredentialPath, $script:IdentityPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "ConfiguraÃ§Ã£o/credencial ausente: $path. Execute primeiro -Configure." }
    }
    $config = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
    if ($config.projectRef -ne $script:ProjectRef -or $config.projectUrl -ne $script:ProjectUrl) { throw 'Destino configurado nÃ£o Ã© o projeto de produÃ§Ã£o autorizado.' }
    if ($config.ageRecipient -notmatch '^age1[0-9a-z]+$') { throw 'DestinatÃ¡rio age invÃ¡lido na configuraÃ§Ã£o.' }
    $sslCertPath = Get-DatabaseTlsSettings $config
    $derived = (& $script:AgeKeygenExe -y $script:IdentityPath 2>$null | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or $derived -ne $config.ageRecipient) { throw 'Identidade age nÃ£o corresponde ao destinatÃ¡rio configurado.' }
    $storedDbCredential = Import-Clixml -LiteralPath $script:DbCredentialPath
    $apiCredential = Import-Clixml -LiteralPath $script:ApiCredentialPath
    if ($storedDbCredential.UserName -notin @('postgres', "postgres.$($script:ProjectRef)") -or $apiCredential.UserName -ne 'service_role') { throw 'As credenciais protegidas nÃ£o sÃ£o do formato esperado.' }
    $connection = Get-DatabaseConnectionSettings $config
    $dbCredential = New-Object System.Management.Automation.PSCredential($connection.User, $storedDbCredential.Password)

    Protect-PrivateDirectory $script:BackupRoot
    $runId = [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $work = Join-Path $script:BackupRoot ('.work-' + [guid]::NewGuid().ToString('N'))
    $final = Join-Path $script:BackupRoot "mk9-production-$runId.zip.age"
    if (Test-Path -LiteralPath $final) { throw 'Backup target already exists; refusing to overwrite.' }
    $reportPath = Join-Path $script:BackupRoot "mk9-production-$runId.report.json"
    $stage = 'initialize-private-work-directory'
    $pgpass = Join-Path $work 'pgpass.conf'
    $zip = Join-Path $work 'backup.zip'
    $recovery = Join-Path $work 'recovered.zip'
    $extract = Join-Path $work 'recovered'
    $hadPgPassFile = Test-Path Env:\PGPASSFILE
    $previousPgPassFile = $env:PGPASSFILE
    $hadSslMode = Test-Path Env:\PGSSLMODE
    $previousSslMode = $env:PGSSLMODE
    $hadSslRootCert = Test-Path Env:\PGSSLROOTCERT
    $previousSslRootCert = $env:PGSSLROOTCERT
    $env:PGPASSFILE = $pgpass
    $env:PGSSLMODE = 'verify-full'
    $env:PGSSLROOTCERT = $sslCertPath
    $dbPassword = $dbCredential.GetNetworkCredential().Password
    $apiKey = $apiCredential.GetNetworkCredential().Password
    $poolerCompatibilityValidated = $false
    try {
        Protect-PrivateDirectory $work
        $stage = 'write-postgresql-password-file'
        $pgpassLine = "$($connection.Host):$($connection.Port):postgres:$($connection.User):$((Escape-PgPass $dbPassword))"
        Set-Content -LiteralPath $pgpass -Value $pgpassLine -Encoding ASCII
        $stage = 'postgresql-readiness-preflight'
        $readyOutput = & (Join-Path $script:PgBin 'pg_isready.exe') -h $connection.Host -p $connection.Port -d postgres -U $dbCredential.UserName -t 8 2>$null
        if ($LASTEXITCODE -ne 0 -and $connection.Mode -eq 'direct' -and $config.PSObject.Properties.Name -contains 'poolerHost') {
            $pooler = Get-DatabaseConnectionSettings ([pscustomobject]@{ databaseConnectionMode = 'session-pooler'; poolerHost = $config.poolerHost })
            Add-Content -LiteralPath $pgpass -Value "$($pooler.Host):$($pooler.Port):postgres:$($pooler.User):$((Escape-PgPass $dbPassword))" -Encoding ASCII
            $readyOutput = & (Join-Path $script:PgBin 'pg_isready.exe') -h $pooler.Host -p $pooler.Port -d postgres -U $pooler.User -t 8 2>$null
            if ($LASTEXITCODE -eq 0) {
                $poolerIdentity = & (Join-Path $script:PgBin 'psql.exe') -X -A -t -w -v ON_ERROR_STOP=1 -h $pooler.Host -p $pooler.Port -d postgres -U $pooler.User -c "select current_database() || '|' || current_user || '|' || current_setting('server_version_num')" 2>$null
                $poolerIdentityParts = (($poolerIdentity | Out-String).Trim() -split '\|')
                if ($LASTEXITCODE -eq 0 -and $poolerIdentityParts.Count -eq 3 -and $poolerIdentityParts[0] -eq 'postgres' -and $poolerIdentityParts[1] -eq 'postgres' -and $poolerIdentityParts[2] -match '^17\d+$') {
                    $connection = $pooler
                    $dbCredential = New-Object System.Management.Automation.PSCredential($connection.User, $storedDbCredential.Password)
                    $compatibilityCode = Test-PgDumpCompatibility $connection $work 'backup-pooler-pgdump-compat'
                    if ($compatibilityCode -ne 'PGDUMP_CONNECTION_COMPATIBLE') { throw 'pg_dump session-pooler compatibility preflight failed.' }
                    $poolerCompatibilityValidated = $true
                } else { throw 'Session pooler did not confirm the production database identity.' }
            }
        }
        if ($LASTEXITCODE -ne 0) { throw 'Preflight PostgreSQL falhou; verifique rede, senha e disponibilidade do projeto.' }
        $stage = 'postgresql-identity-preflight'
        $identity = & (Join-Path $script:PgBin 'psql.exe') -X -A -t -w -v ON_ERROR_STOP=1 -h $connection.Host -p $connection.Port -d postgres -U $dbCredential.UserName -c "select current_database() || '|' || current_user || '|' || current_setting('server_version_num')" 2>$null
        $identityParts = (($identity | Out-String).Trim() -split '\|')
        if ($LASTEXITCODE -ne 0 -or $identityParts.Count -ne 3 -or $identityParts[0] -ne 'postgres' -or $identityParts[1] -ne 'postgres' -or $identityParts[2] -notmatch '^17\d+$') { throw 'Preflight SQL nÃ£o confirmou identidade do banco PostgreSQL 17.' }
        if ($connection.Mode -eq 'session-pooler' -and -not $poolerCompatibilityValidated) {
            $compatibilityCode = Test-PgDumpCompatibility $connection $work 'backup-pooler-pgdump-compat'
            if ($compatibilityCode -ne 'PGDUMP_CONNECTION_COMPATIBLE') { throw 'pg_dump session-pooler compatibility preflight failed.' }
        }

        if (-not (Test-ApiHeaderValue $apiKey)) { throw 'API_CREDENTIAL_HEADER_INVALID' }
        $headers = @{ apikey = $apiKey; Authorization = "Bearer $apiKey" }
        $stage = 'auth-api-preflight'
        $authPreflight = Invoke-RestMethod -Method Get -Uri "$($script:ProjectUrl)/auth/v1/admin/users?page=1`&per_page=1" -Headers $headers -TimeoutSec 30
        if ($null -eq $authPreflight.PSObject.Properties['users']) { throw 'AUTH_RESPONSE_SHAPE_INVALID' }
        $authPreflight = $null
        $stage = 'storage-api-preflight'
        $storagePreflight = @(Invoke-RestMethod -Method Get -Uri "$($script:ProjectUrl)/storage/v1/bucket" -Headers $headers -TimeoutSec 30)
        $storagePreflight = $null

        $databaseDump = Join-Path $work 'database.dump'
        $stage = 'postgresql-export'
        & (Join-Path $script:PgBin 'pg_dump.exe') -h $connection.Host -p $connection.Port -U $dbCredential.UserName -d postgres -Fc -f $databaseDump 2>$null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $databaseDump) -or (Get-Item $databaseDump).Length -eq 0) { throw 'pg_dump falhou; nenhum backup serÃ¡ declarado vÃ¡lido.' }
        & (Join-Path $script:PgBin 'pg_restore.exe') --list $databaseDump 2>$null | Out-File -FilePath (Join-Path $work 'database.toc.txt') -Encoding ASCII
        if ($LASTEXITCODE -ne 0) { throw 'ValidaÃ§Ã£o TOC de pg_dump falhou.' }
        $dbObjects = @(Get-Content (Join-Path $work 'database.toc.txt') | Where-Object { $_ -match '^\d+;\s+\d+\s+\d+\s+' }).Count
        if ($dbObjects -lt 1) { throw 'O dump do banco nÃ£o contÃ©m objetos listÃ¡veis.' }

        $authDir = Join-Path $work 'auth'
        New-Item -ItemType Directory -Path $authDir | Out-Null
        $users = [Collections.Generic.List[object]]::new()
        $page = 1
        $stage = 'auth-users-export'
        do {
            $response = Invoke-RestMethod -Method Get -Uri "$($script:ProjectUrl)/auth/v1/admin/users?page=$page`&per_page=1000" -Headers $headers -TimeoutSec 60
            $batch = @($response.users)
            foreach ($user in $batch) { $users.Add($user) }
            $page++
        } while ($batch.Count -eq 1000)
        @{ users = @($users) } | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $authDir 'users.json') -Encoding UTF8

        $storageRoot = Join-Path $work 'storage'
        New-Item -ItemType Directory -Path $storageRoot | Out-Null
        $stage = 'storage-bucket-list'
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
                    $stage = 'storage-object-list'
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
                            $stage = 'storage-object-download'
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
        $stage = 'manifest-build'
        Write-Manifest $work $counts
        $stage = 'archive-create'
        Compress-Archive -Path (Join-Path $work 'database.dump'),(Join-Path $work 'database.toc.txt'),(Join-Path $work 'auth'),(Join-Path $work 'storage'),(Join-Path $work 'manifest.json') -DestinationPath $zip -CompressionLevel Optimal
        $stage = 'age-encryption'
        & $script:AgeExe -r $config.ageRecipient -o $final $zip 2>$null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $final)) { throw 'Criptografia do backup falhou.' }
        $cipherHash = Get-Sha256 $final
        $stage = 'age-decryption-validation'
        & $script:AgeExe -d -i $script:IdentityPath -o $recovery $final 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Teste de descriptografia do backup falhou.' }
        Expand-Archive -LiteralPath $recovery -DestinationPath $extract
        $stage = 'internal-manifest-validation'
        Assert-Manifest $extract
        $stage = 'postgresql-dump-recovery-validation'
        & (Join-Path $script:PgBin 'pg_restore.exe') --list (Join-Path $extract 'database.dump') 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'O dump recuperado nÃ£o passou na validaÃ§Ã£o pg_restore.' }
        $stage = 'success-report'
        $report = [ordered]@{ status = 'SUCCESS'; projectRef = $script:ProjectRef; completedAtUtc = [DateTime]::UtcNow.ToString('o'); encryptedFile = [IO.Path]::GetFileName($final); encryptedBytes = (Get-Item $final).Length; encryptedSha256 = $cipherHash; counts = $counts; recoveryValidation = 'PASSED' }
        $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding UTF8
        Write-Host "Backup completo validado: $final"
        Write-Host "RelatÃ³rio sem credenciais/dados pessoais: $reportPath"
    }
    catch {
        if (Test-Path -LiteralPath $final) { Remove-Item -LiteralPath $final -Force }
        $failure = [ordered]@{ status = 'FAILED'; projectRef = $script:ProjectRef; completedAtUtc = [DateTime]::UtcNow.ToString('o'); error = 'Falha em uma etapa; backup nÃ£o Ã© considerado vÃ¡lido.' }
        $failure.failedStage = $stage
        $failure.failureType = if ($_.Exception) { $_.Exception.GetType().Name } else { 'UnknownException' }
        $failure | ConvertTo-Json | Set-Content -LiteralPath $reportPath -Encoding UTF8
        Write-Error 'Backup interrompido. Detalhes sensÃ­veis foram omitidos; consulte o relatÃ³rio de falha.'
        exit 1
    }
    finally {
        if ($hadPgPassFile) { $env:PGPASSFILE = $previousPgPassFile } else { Remove-Item Env:\PGPASSFILE -ErrorAction SilentlyContinue }
        if ($hadSslMode) { $env:PGSSLMODE = $previousSslMode } else { Remove-Item Env:\PGSSLMODE -ErrorAction SilentlyContinue }
        if ($hadSslRootCert) { $env:PGSSLROOTCERT = $previousSslRootCert } else { Remove-Item Env:\PGSSLROOTCERT -ErrorAction SilentlyContinue }
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

if ($TestAcl) { Invoke-AclRegressionTest; exit 0 }
if ($SelfTest) { Invoke-SelfTest; exit 0 }
if ($Configure) { Invoke-Configure; exit 0 }
if ($ConfigureApiCredential) { Invoke-ConfigureApiCredential; exit 0 }
if ($ConfigureDatabaseEndpoint) { Invoke-ConfigureDatabaseEndpoint; exit 0 }
if ($ConfigureDatabaseCredential) { Invoke-ConfigureDatabaseCredential; exit 0 }
if ($Diagnose) { Invoke-ProductionDiagnostics; exit 0 }
Invoke-ProductionBackup
