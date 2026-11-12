# MK9 DATE — Manual de Backup e Recuperabilidade da Produção (Missão 57)

**Projeto Supabase Produção:** `xzmbesqhxcnuokjwrbnw`  
**Região AWS:** `sa-east-1` (São Paulo)  
**Banco:** PostgreSQL 17  
**Workflow GitHub Actions:** `.github/workflows/supabase-production-backup.yml`  
**GitHub Environment Requerido:** `production-backup`  
**Branch Exclusiva Autorizada:** `codex/m57.2-production-backup-workflow`  

---

## 1. Visão Geral da Arquitetura e Correções das Missões 57.4 e 57.6

A infraestrutura foi aprimorada com base nas auditorias de segurança e bloqueios técnicos das Missões 57.3 e 57.5:

1. **Operações Remotas e DDL Temporária de Sessão:**
   - Realiza operações remotas de leitura e diagnóstico (`SHOW server_version_num`, `pg_dump --format=custom`, `supabase db dump --role-only`, e download de arquivos via Storage API).
   - O inventário pré e pós-backup executa `psql -f scripts/backup-inventory.sql`, que declara `CREATE OR REPLACE FUNCTION pg_temp.mk9_backup_inventory()`.
   - **Esclarecimento técnico de segurança:** Embora o schema `pg_temp` pertença unicamente ao namespace temporário da conexão ativa e evapore por completo no momento em que a sessão TCP/TLS é encerrada (sem tocar nem alterar o catálogo permanente nem tabelas do banco de produção), formalmente trata-se de uma DDL temporária de sessão (`CREATE FUNCTION` no schema volátil de trabalho), e não de leitura estrita no sentido mais puro do protocolo SQL.
   - O banco de produção **não sofre nenhuma escrita ou alteração em seus schemas permanentes (`public`, `storage`, `auth`, etc.)**. O inventário de tabelas, contagens de registros, views e extensões é conferido antes e depois do dump remoto para comprovação matemática de zero alterações.
2. **Escopo Mínimo de Segredos no Workflow:**
   - Nenhum segredo (`SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_GPG_PASSPHRASE`) fica exposto no `env` global do job no GitHub Actions.
   - Os segredos são injetados estritamente nos steps que deles necessitam (`Run preflight and security checks` e `Export, restore-test, and encrypt production backup`), impedindo propagação acidental para steps de inicialização ou upload de artefatos.
3. **Validação Rigorosa de Integridade do Storage:**
   - Não apenas verifica metadados, mas realiza o download binário real de cada objeto na stack descartável local, recalculando os hashes SHA-256 e tamanhos em bytes.
   - Valida parâmetros essenciais de segurança dos buckets (`public`, `file_size_limit`, `allowed_mime_types`).
   - Detecta e aborta imediatamente em caso de arquivos corrompidos, divergência de tamanho ou configurações alteradas.
4. **Resolução Inequívoca e Vinculação Estrita do Container Docker Descartável:**
   - Eliminado qualquer fallback ambíguo (`head -n 1`).
   - O script localiza os contêineres com filtro `name=supabase_db_`, exige contagem exatamente igual a 1, e valida o formato hexadecimal rigoroso do ID (`^[0-9a-fA-F]{12,64}$`). Caso contrário, o workflow aborta imediatamente com erro explícito de segurança (`DISPOSABLE_CONTAINER_RESOLUTION_FAILED`).
5. **Reconciliação e Empacotamento Restrito de Migrations:**
   - O pipeline empacota estritamente os arquivos `.sql` executáveis localizados diretamente na raiz de `supabase/migrations`. Subdiretórios de documentação e rascunhos (ex.: `propostas/`) são catalogados como itens excluídos com hash SHA-256 e tamanho para fins de auditoria, sem contaminação do pacote de execução.
   - O script `reconcile-migrations.mjs` valida o ledger de produção (`supabase_migrations.schema_migrations`). Se for detectada qualquer migração registrada na base de produção que não possua o respectivo arquivo no repositório (`registeredWithoutFile`), o script emite erro crítico com código de saída 1 e aborta a execução do pipeline.
   - Formatos malformados, ledger vazio ou erros de leitura do arquivo SQL também resultam em encerramento imediato com erro (sem aprovação silenciosa).
   - Migrations presentes no repositório mas ainda não aplicadas na produção são explicitamente diferenciadas no relatório como `pendingExecution`, sem bloquear o backup de uma base em estado prévio a essas alterações.
6. **Criptografia Simétrica GPG AES-256 e Limpeza:**
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

### Análise de Opções e Impacto no Vercel:

* **Opção 1 — Registro Seguro Exclusivo do Workflow na `main` (Estratégia Recomendada):**
  - **Procedimento:** Criar um PR ou commit restrito na `main` contendo **exclusivamente** o arquivo de workflow `.github/workflows/supabase-production-backup.yml`, sem scripts, código, pacotes npm ou migrations.
  - **Análise de Risco de Deploy no Vercel:** O Vercel monitora por padrão a branch de produção (`main`). Contudo, commits que alteram unicamente arquivos dentro de `.github/` não afetam os arquivos de build da aplicação (como `src/`, `package.json`, etc.). Mesmo se um trigger de build do Vercel for avaliado, ele detectará ausência de alterações de código ou poderá ser ignorado pelo build filter do Vercel. Mais importante: como nenhuma migration ou funcionalidade é incluída, o risco de deploy de aplicação ou regressão é nulo.
  - **Segurança de Execução:** Como o workflow contém a guarda explícita `if: github.ref == 'refs/heads/codex/m57.2-production-backup-workflow'`, qualquer tentativa acidental de disparar o workflow apontando para a `main` é imediatamente ignorada pelo runner.
  - **Vantagem:** Permite o disparo limpo, auditado e reproduzível pelo GitHub Actions selecionando a branch de trabalho isolada.
* **Opção 2 — Execução Local Assistida via Script (Sem GitHub Actions):**
  - **Procedimento:** Executar o script `mk9-supabase-production-backup.sh` em máquina local segura com Docker, injetando as variáveis via ambiente local.
  - **Vantagem:** Zero alterações no GitHub.
  - **Desvantagem:** Depende de ambiente Docker local e conexão da máquina de desenvolvimento com o Supabase.

---

## 4. Análise de Credenciais de Leitura e Menor Privilégio

### A. Diagnóstico de Viabilidade de Credencial Exclusiva de Leitura
1. **Operações PostgreSQL no Backup:**
   - `pg_dump`: Para exportar integralmente os schemas da aplicação (`public`, etc.) e os schemas gerenciados pelo Supabase (`auth`, `storage`), o usuário PostgreSQL precisa ter permissão `SELECT` em todas as tabelas e sequências, além de privilégio de leitura sobre definições de tipos, triggers e schemas. No PostgreSQL padrão, um role customizado (ex.: `backup_reader`) precisaria de `pg_read_all_data` e acesso aos schemas de sistema.
   - `supabase db dump --role-only`: A CLI do Supabase e o `pg_dumpall --roles-only` exigem privilégio de leitura sobre tabelas de catálogo protegidas (como `pg_authid`). No Supabase gerenciado, apenas o superusuário interno (`supabase_admin`) ou o role administrativo `postgres` possuem permissões suficientes para inspecionar credenciais e roles.
   - Inventário pré e pós-backup (`backup-inventory.sql`): Cria uma função em `pg_temp` e executa consultas reflexivas em `pg_class`, `pg_namespace`, etc. Um role de leitura comum conseguiria executar o inventário.
2. **Operações Storage:**
   - A listagem e download de arquivos via REST API do Storage Supabase utilizam a chave `service_role`. No modelo Supabase, a chave `service_role` ignora RLS (Row Level Security) e possui privilégios totais sobre a API REST/Storage.
   - Não existe no Supabase atual uma chave nativa "storage_read_only" via token JWT sem personalização profunda de claims ou proxies intermediários.
3. **Riscos Residuais do Uso de `postgres` e `service_role`:**
   - Como o `postgres` possui permissões DDL/DML e o `service_role` ignora RLS, qualquer comando malicioso no runner poderia teoricamente alterar dados se o script fosse adulterado.
4. **Contramedidas e Isolamento Obrigatórios:**
   - **Somente-leitura comprovada em runtime:** O script executa apenas `pg_dump` e downloads, sem nenhum `INSERT`, `UPDATE` ou `DROP` remoto. O inventário pré e pós-backup compara tabelas e contagens de linhas para comprovação matemática de ausência de alterações.
   - **Guarda de IP e Session Pooler:** A conexão é restrita ao host do pooler com `sslmode=verify-full` e validação estrita da Root CA oficial da Supabase.
   - **GitHub Environment Protection:** Exigência de revisão manual (Required Reviewers) e branch restrita (`codex/m57.2-production-backup-workflow`) no GitHub Environment `production-backup`.

---

## 5. Estratégia para Fixar o Commit Executado (Imutabilidade de Execução)

Para garantir que a execução do backup no GitHub Actions utilize exatamente a versão auditada e aprovada, sem risco de commits adicionais ou alterações inesperadas na branch:
1. **Fixação por Commit SHA:**
   - No workflow `.github/workflows/supabase-production-backup.yml`, o step `Check out this implementation branch` pode receber o SHA específico revisado ou um input opcional `commit_sha` no `workflow_dispatch`.
   - Exemplo:
     ```yaml
     - name: Check out this implementation branch
       uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
       with:
         ref: ${{ inputs.commit_sha || 'codex/m57.2-production-backup-workflow' }}
         persist-credentials: false
     ```
2. **Validação no Preflight:**
   - O script `production-preflight.mjs` pode validar se o commit em execução (`process.env.GITHUB_SHA`) corresponde exatamente ao commit aprovado pelo conselho técnico antes de permitir o avanço do pipeline.

---

## 6. Procedimento Operacional em Caso de Divergência de Migrations

Se a execução do workflow for interrompida pelo validador com o erro `REGISTERED_MIGRATION_WITHOUT_FILE`:
1. **Não inventar arquivos e não editar o ledger:** Nunca crie migrations vazias ou fictícias para tentar "burlar" a validação, nem modifique o ledger `supabase_migrations.schema_migrations` na base de produção.
2. **Identificar a migração ausente:** Consulte os logs do step `Run preflight and security checks` ou o arquivo gerado `reconciled-migrations.json` para identificar a versão exata faltante.
3. **Auditoria no Git:** Busque o arquivo correspondente nas branches históricas do repositório (ex.: `git log --all --full-history -- "supabase/migrations/*<versão>*"`).
4. **Checkout e incorporação:** Faça o checkout do arquivo de migration legítimo e adicione-o ao diretório `supabase/migrations/` da branch `codex/m57.2-production-backup-workflow`, garantindo que o checksum e o conteúdo reflitam exatamente a migração aplicada.
5. **Re-executar o workflow:** Após o commit na branch de trabalho, dispare novamente o workflow de backup.

---

## 5. Retenção, Cotas e Limites do GitHub Actions

1. **Cota de Minutos:**
   - Em repositórios públicos, o GitHub Actions oferece execução gratuita ilimitada de runners padrão (`ubuntu-latest` / `ubuntu-24.04`), respeitando o limite de concorrência simultânea.
   - Para consultar o consumo e limites de armazenamento: acesse *GitHub Settings > Billing and plans > Plans and usage*.
2. **Armazenamento de Artefatos:**
   - O artefato publicado (`mk9-production-backup-...tar.gz.gpg`) está configurado com retenção estrita de **1 dia** (`retention-days: 1`).
   - Ele é criptografado com AES-256 antes do upload, eliminando o risco de exposição pública no repositório.
3. **Preservação Durável:**
   - O administrador deve fazer o download do artefato `.zip` pelo painel de Actions em até 24 horas e arquivá-lo em armazenamento seguro e durável (cold storage corporativo ou cofre local).
