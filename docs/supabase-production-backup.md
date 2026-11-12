# MK9 DATE — Manual de Backup e Recuperabilidade da Produção (Missão 57)

**Projeto Supabase Produção:** `xzmbesqhxcnuokjwrbnw`  
**Região AWS:** `sa-east-1` (São Paulo)  
**Banco:** PostgreSQL 17  
**Workflow GitHub Actions:** `.github/workflows/supabase-production-backup.yml`  
**GitHub Environment Requerido:** `production-backup`  
**Branch Exclusiva Autorizada:** `codex/m57.2-production-backup-workflow`  

---

## 1. Visão Geral da Arquitetura e Correções da Missão 57.4

A infraestrutura foi aprimorada com base na auditoria de segurança da Missão 57.3:

1. **Leitura Remota Estrita e Não-Destrutiva:**
   - Realiza consultas estritas de somente-leitura (`SHOW server_version_num`, consultas analíticas diretas de inventário via `psql -f scripts/backup-inventory.sql`, `pg_dump --format=custom`, `supabase db dump --role-only`, e download de arquivos via Storage API).
   - A função de inventário é criada exclusivamente no schema volátil `pg_temp` (função temporária de sessão que inexiste e evapora ao encerrar a conexão TCP/TLS).
   - O banco de produção **não sofre nenhuma escrita ou alteração** durante todo o ciclo. O inventário é conferido antes e depois do dump remoto para comprovação matemática de zero alterações.
2. **Validação Rigorosa de Integridade do Storage:**
   - Não apenas verifica metadados, mas realiza o download binário real de cada objeto na stack descartável local, recalculando os hashes SHA-256 e tamanhos em bytes.
   - Valida parâmetros essenciais de segurança dos buckets (`public`, `file_size_limit`, `allowed_mime_types`).
   - Detecta e aborta imediatamente em caso de arquivos corrompidos, divergência de tamanho ou configurações alteradas.
3. **Resolução Inequívoca do Container Docker Descartável:**
   - Eliminado qualquer fallback para containers arbitrários (`head -n 1`).
   - O script localiza estritamente os contêineres com filtro `name=supabase_db_` e exige contagem igual a exatamente 1. Caso contrário, o workflow aborta com erro explícito de segurança (`DISPOSABLE_CONTAINER_RESOLUTION_FAILED`).
4. **Reconciliação e Empacotamento de Migrations:**
   - O pipeline agora empacota todas as migrações SQL do repositório em `migrations-bundle/`, gerando manifesto com hashes SHA-256 e bytes.
   - O script `reconcile-migrations.mjs` reconcilia em runtime as migrações registradas no ledger da base de produção (`supabase_migrations.schema_migrations`) com os arquivos versionados no repositório, alertando sobre qualquer migração orfã ou ausente.
5. **Criptografia Simétrica GPG AES-256 e Limpeza:**
   - Geração de `SHA256SUMS` de todos os arquivos exportados.
   - Criptografia simétrica com **GPG AES-256**.
   - Descriptografia de teste em runtime verificando que o arquivo gerado pode ser recuperado com a chave informada.
   - Trap de limpeza com `rm -rf "$ROOT"` garantindo remoção de dados temporários no encerramento da execução.

---

## 2. Configuração do GitHub Environment (`production-backup`)

Para executar o workflow, o repositório no GitHub deve possuir o Environment **`production-backup`** configurado manualmente pelo administrador:

### A. Deployment Branch Policy
- Configurar para **Selected branches**.
- Adicionar regra de proteção exigindo a branch:
  ```text
  codex/m57.2-production-backup-workflow
  ```

### B. Deployment Protection Rules (Revisão Obrigatória)
- Ativar **Required reviewers**.
- Definir o mantenedor responsável para autorizar manualmente cada disparo de workflow que acesse os segredos de produção.

### C. Environment Variables (`vars`)
| Nome da Variável | Valor Exato / Descrição |
| :--- | :--- |
| `SUPABASE_PROJECT_REF` | `xzmbesqhxcnuokjwrbnw` |
| `SUPABASE_PROJECT_URL` | `https://xzmbesqhxcnuokjwrbnw.supabase.co` |
| `SUPABASE_POOLER_HOST` | Host do Session Pooler exibido no Supabase Dashboard (ex: `aws-0-sa-east-1.pooler.supabase.com`) |

### D. Environment Secrets (`secrets`)
> [!IMPORTANT]
> Nunca compartilhe ou envie o conteúdo destes segredos em canais de chat ou logs.

| Nome do Segredo | Instrução de Obtenção |
| :--- | :--- |
| `SUPABASE_DB_URL` | String de conexão Session Pooler obtida em *Project Settings > Database > Connection Pooling* (porta 5432, usuário `postgres.xzmbesqhxcnuokjwrbnw`). O workflow normaliza automaticamente com `sslmode=verify-full` e certificado oficial Root CA. Recomenda-se utilizar credencial com privilégios restritos a leitura. |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave `service_role` secreta obtida em *Project Settings > API*. |
| `BACKUP_GPG_PASSPHRASE` | Frase secreta forte com no mínimo 32 caracteres gerada pelo administrador para criptografia AES-256 do artefato. Deve ser guardada em cofre seguro de senhas. |

---

## 3. Estratégia de Execução do Workflow (Sem Merge de Código na `main`)

No GitHub Actions, um workflow disparado via `workflow_dispatch` precisa ter seu arquivo YAML presente na branch padrão (`main`) para que a interface web ou CLI o reconheça e permita selecionar qualquer branch de destino.

### Análise de Opções:

* **Opção 1 — Registro Seguro Exclusivo do Workflow na `main` (Estratégia Homologada):**
  - **Procedimento:** Criar um PR ou commit restrito na `main` contendo **apenas** o arquivo de workflow `.github/workflows/supabase-production-backup.yml`, sem scripts, código ou migrations.
  - **Segurança:** Como o workflow é `on: workflow_dispatch` com `if: github.ref == 'refs/heads/codex/m57.2-production-backup-workflow'`, nenhuma execução automática é provocada na `main`, não há deploy para Vercel e nenhuma funcionalidade é mesclada.
  - **Vantagem:** Permite o disparo limpo e auditado pelo GitHub Actions selecionando a branch isolada.
* **Opção 2 — Execução Local Assistida via Script (Sem GitHub Actions):**
  - **Procedimento:** Executar o script `mk9-supabase-production-backup.sh` em máquina local segura com Docker, injetando as variáveis via ambiente local.
  - **Vantagem:** Zero alterações no GitHub.
  - **Desvantagem:** Depende de ambiente Docker local e conexão da máquina de desenvolvimento com o Supabase.

---

## 4. Retenção, Cotas e Limites do GitHub Actions

1. **Cota de Minutos:**
   - Em repositórios públicos, o GitHub Actions oferece execução gratuita ilimitada de runners padrão (`ubuntu-latest` / `ubuntu-24.04`), respeitando o limite de concorrência simultânea.
   - Para consultar o consumo e limites de armazenamento: acesse *GitHub Settings > Billing and plans > Plans and usage*.
2. **Armazenamento de Artefatos:**
   - O artefato publicado (`mk9-production-backup-...tar.gz.gpg`) está configurado com retenção estrita de **1 dia** (`retention-days: 1`).
   - Ele é criptografado com AES-256 antes do upload, eliminando o risco de exposição pública no repositório.
3. **Preservação Durável:**
   - O administrador deve fazer o download do artefato `.zip` pelo painel de Actions em até 24 horas e arquivá-lo em armazenamento seguro e durável (cold storage corporativo ou cofre local).
