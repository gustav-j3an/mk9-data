# Automação local de backup de produção

O script `scripts/mk9-prod-backup.ps1` prepara um backup lógico local do projeto Supabase `xzmbesqhxcnuokjwrbnw`, sem Docker, Actions ou Google Cloud. O fluxo usa PostgreSQL 17, as APIs administrativas de Auth e Storage, e `age` para criptografar o pacote.

## Configuração inicial, uma vez por usuário do Windows

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\mk9-prod-backup.ps1 -Configure
```

O comando solicita a senha do banco, a chave `service_role`, o destinatário público age e o caminho da identidade privada age correspondente. As duas credenciais são gravadas como `PSCredential` protegidas por DPAPI para o usuário Windows atual. A identidade privada é copiada para `%LOCALAPPDATA%\MK9-Date\ProductionBackup`, cuja ACL limita acesso ao usuário atual e ao `SYSTEM`. O arquivo de configuração contém apenas a referência de produção e o destinatário público.

Use uma identidade age cuja chave privada tenha uma cópia de recuperação armazenada com segurança fora deste computador. O script recusa configuração se o destinatário não corresponder à identidade privada.

## Execução futura

Na raiz do repositório, um único comando executa o processo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\mk9-prod-backup.ps1
```

O destino é `%LOCALAPPDATA%\MK9-Date\ProductionBackup\Backups`, fora do repositório e protegido por ACL do Windows. O arquivo `.zip.age` somente é mantido quando o preflight PostgreSQL/Auth, exportação do banco, Auth e Storage, hash do ciphertext, descriptografia e verificação do manifesto passam. Um relatório JSON separado registra resultado, hashes, tamanhos e contagens sem credenciais ou dados pessoais. O conteúdo em claro de trabalho e o arquivo temporário de senha são removidos ao final; se a limpeza falhar, o arquivo cifrado é invalidado.

## Testes offline

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\mk9-prod-backup.ps1 -SelfTest
```

O self-test cria fixtures fictícias temporárias, gera uma identidade age descartável, compacta, criptografa, descriptografa e confere o manifesto/hashes; também injeta corrupção para testar a falha e remove o diretório temporário. Não consulta o Supabase.

## Escopo e limites

- O dump custom do PostgreSQL cobre o banco `postgres` acessível à credencial; globals/roles gerenciados pela plataforma não fazem parte de `pg_dump` e devem ser tratados pelo procedimento de recuperação Supabase.
- Auth é exportado pela API Admin de listagem de usuários. Storage é enumerado recursivamente por bucket e cada objeto é baixado; qualquer falha aborta o backup.
- O teste `pg_restore --list` e os hashes comprovam integridade do arquivo e recuperabilidade sintática do dump. Não substituem ensaio de restauração em um banco isolado.
- Não há configuração local da credencial `service_role`, senha PostgreSQL ou identidade age neste computador; portanto, o modo real para antes de qualquer conexão até a configuração inicial ser feita.
