# MK9 DATE — Manual de Backup e Recuperabilidade da Produção (Missão 57)

**Projeto Supabase Produção:** `xzmbesqhxcnuokjwrbnw`  
**Região AWS:** `sa-east-1` (São Paulo)  
**Banco:** PostgreSQL 17  
**Workflow GitHub Actions:** `.github/workflows/supabase-production-backup.yml`  
**GitHub Environment:** `production-backup`  
**Branch Exclusiva Autorizada:** `codex/m57.2-production-backup-workflow`  

---

## 1. Visão Geral da Arquitetura

O mecanismo de backup da produção foi adaptado diretamente a partir da infraestrutura homologada na Missão 42.12 (Run `43124784988`), com separação estrita de privilégios e ambientes:

1. **Leitura Estrita Remota:**
   - Realiza consultas estritas de somente-leitura (`SHOW server_version_num`, `SELECT` via script de inventário seguro, `pg_dump --format=custom`, `supabase db dump --role-only`, e download de objetos via API do Storage).
   - O banco de produção **não sofre nenhuma escrita ou alteração** durante todo o ciclo.
2. **Validação Descartável Isolada (Restore Drill):**
   - Um cluster PostgreSQL 17 efêmero local é inicializado dentro do runner (`supabase start`).
   - O banco descartável `mk9_backup_restore` é criado localmente.
   - O dump é restaurado no container descartável.
   - O inventário completo (tabelas, contagens de linhas, hashes SHA-256 de dados por tabela, schemas, ownership, sequências, RLS, policies, triggers, functions e extensions) é extraído do container descartável e comparado com o inventário original da produção.
   - O Storage é restaurado em instância local da API de Storage e os hashes dos arquivos binários são verificados contra o manifesto original.
3. **Empacotamento e Criptografia:**
   - Cálculo de `SHA256SUMS` de todos os arquivos exportados.
   - Criptografia simétrica robusta com **GPG AES-256**.
   - Teste de descriptografia em runtime para assegurar que a chave utilizada é capaz de recuperar o arquivo.
   - Publicação do artefato criptografado `.tar.gz.gpg` com retenção curta (1 dia).

---

## 2. Configuração do GitHub Environment (`production-backup`)

Para executar o workflow, o repositório no GitHub deve possuir o Environment **`production-backup`** com as seguintes configurações:

### A. Deployment Branch Policy
- Configurar para **Selected branches**.
- Adicionar regra para permitir exclusivamente:
  ```text
  codex/m57.2-production-backup-workflow
  ```

### B. Environment Variables (`vars`)
| Nome da Variável | Valor Exato / Descrição |
| :--- | :--- |
| `SUPABASE_PROJECT_REF` | `xzmbesqhxcnuokjwrbnw` |
| `SUPABASE_PROJECT_URL` | `https://xzmbesqhxcnuokjwrbnw.supabase.co` |
| `SUPABASE_POOLER_HOST` | Host do Session Pooler exibido no Supabase Dashboard (ex: `aws-0-sa-east-1.pooler.supabase.com`) |

### C. Environment Secrets (`secrets`)
> [!IMPORTANT]
> Nunca compartilhe ou envie o conteúdo destes segredos em canais de chat ou logs.

| Nome do Segredo | Instrução de Obtenção |
| :--- | :--- |
| `SUPABASE_DB_URL` | String de conexão Session Pooler obtida em *Project Settings > Database > Connection Pooling* (porta 5432, usuário `postgres.xzmbesqhxcnuokjwrbnw`). O workflow normaliza automaticamente com `sslmode=verify-full` e certificado oficial Root CA. |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave `service_role` secreta obtida em *Project Settings > API*. |
| `BACKUP_GPG_PASSPHRASE` | Senha aleatória forte com no mínimo 32 caracteres gerada pelo administrador para criptografia AES-256 do artefato. Deve ser guardada em cofre seguro de senhas para futura recuperação. |

---

## 3. Procedimento de Execução

Após a criação e configuração do Environment `production-backup`:

1. No GitHub, acesse a aba **Actions**.
2. Selecione o workflow **`MK9 production backup and restore validation`**.
3. Clique em **Run workflow**:
   - **Branch:** `codex/m57.2-production-backup-workflow`
   - **project_ref:** `xzmbesqhxcnuokjwrbnw`
   - **confirm_artifact_access:** `true` (marcar checkbox)
4. Acompanhe a execução:
   - Se qualquer preflight ou verificação falhar, os logs permanecem protegidos e nenhum dado é exposto.
   - Ao final com sucesso, baixe o artefato `mk9-production-backup-<run_id>-<attempt>.zip`.
