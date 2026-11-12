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

## 3. Arquitetura de Proteção do Workflow e Código Executado (Missões 57.9 e 57.10)

### A. Diagnóstico da Vulnerabilidade de Modificação de Workflow
No modelo do GitHub Actions com `workflow_dispatch`:
- Quando um workflow é disparado selecionando uma branch de desenvolvimento (ex.: `codex/m57.2-production-backup-workflow`), o GitHub Actions lê e executa a definição do arquivo YAML **da própria branch selecionada**.
- **Vulnerabilidade Identificada:** Mesmo que o step `actions/checkout` aponte para um commit imutável, se o arquivo YAML puder ser alterado na branch de desenvolvimento sem revisão, um autor mal-intencionado poderia modificar os passos anteriores ou posteriores (por exemplo, injetando comandos arbitrários que imprimem ou transmitem secrets nos steps onde `secrets.SUPABASE_DB_URL` é injetado).
- Portanto, **proteger o código dos scripts não é suficiente se a definição do próprio workflow na branch não for protegida com igual rigor**.

### B. Arquitetura de Defesa em Profundidade Proposta
Para garantir que **tanto o workflow quanto os scripts executados** sejam previamente auditados e aprovados, adota-se uma arquitetura em 3 camadas de blindagem:

1. **Camada 1 — Workflow Gravado em Branch Protegida (`main`):**
   - O arquivo `.github/workflows/supabase-production-backup.yml` que contém os steps, as injeções de secrets e a chamada dos scripts deve residir na branch padrão (`main`).
   - A branch `main` possui proteção nativa do GitHub (exigência de Pull Request, revisões mínimas, verificação de status e proibição de push direto).
   - O workflow na `main` possui a guarda imutável de checkout fixada no commit SHA aprovado:
     ```yaml
     - name: Check out isolated production backup implementation
       uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
       with:
         ref: ${{ vars.APPROVED_COMMIT_SHA || '8926bb8751383a3543eff6ae0674e2116f9ab6cb' }}
         persist-credentials: false
     ```
   - O workflow define explicitamente os comandos a serem executados (`node scripts/production-preflight.mjs`, `bash scripts/mk9-supabase-production-backup.sh`), impedindo qualquer injeção dinâmica de novos comandos.

2. **Camada 2 — Código e Scripts Imutáveis por Commit SHA:**
   - O runner monta no disco exclusivamente o conteúdo do commit SHA fixado.
   - Qualquer push subsequente na branch `codex/m57.2-production-backup-workflow` é totalmente ignorado pela execução do checkout.
   - O script `production-preflight.mjs` valida via `git rev-parse HEAD` se os arquivos no disco correspondem exatamente ao SHA aprovado (40 caracteres hexadecimais), abortando imediatamente em caso de divergência (`COMMIT_SHA_MISMATCH`).

3. **Camada 3 — Governança de Acesso via GitHub Environment (`production-backup`):**
   - Os secrets de produção (`SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_GPG_PASSPHRASE`) ficam armazenados exclusivamente no GitHub Environment `production-backup`.
   - Regras obrigatórias do Environment:
     - **Required Reviewers:** Todo disparo de workflow para este Environment exige autorização manual de pelo menos um mantenedor credenciado antes que o job inicie e receba os secrets.
     - **Deployment Branch Policy:** Acesso concedido exclusivamente quando o workflow for executado a partir de branches autorizadas.
     - **Environment Variable `APPROVED_COMMIT_SHA`:** Permite que o revisor atualize o SHA aprovado no painel do GitHub sem precisar alterar código.

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

## 5. Mecanismo de Fixação do Commit e Imutabilidade de Execução (Missão 57.9)

Para garantir que a execução do backup no GitHub Actions utilize rigorosamente o código previamente auditado e aprovado, impedindo que alterações posteriores na branch de desenvolvimento sejam executadas automaticamente contra a produção:

### A. Duplo Bloqueio de Imutabilidade:
1. **Checkout Fixado no Commit SHA Completo:**
   - No workflow `.github/workflows/supabase-production-backup.yml`, a action `actions/checkout` não utiliza a referência mutável da branch (`HEAD`), mas sim o hash completo de 40 caracteres hexadecimais:
     ```yaml
     - name: Check out this implementation branch
       uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
       with:
         ref: ${{ vars.APPROVED_COMMIT_SHA || '2fa19be1d00e8674d583b8411eaa3770c5256f2f' }}
         persist-credentials: false
     ```
2. **Validação Ativa do Código Efetivamente Executado (Preflight Gate):**
   - No step `Run preflight and security checks`, a função `verifyCheckedOutCommit()` em `scripts/production-preflight.mjs` consulta diretamente o repositório local montado pelo runner através de `git rev-parse HEAD`.
   - **Rejeição Estrita:**
     - Rejeita SHAs abreviados (ex.: `2fa19be`).
     - Rejeita nomes de branches ou tags (ex.: `codex/m57.2-production-backup-workflow`, `main`).
     - Rejeita formatos não hexadecimais ou vazios.
     - Lança erro crítico `COMMIT_SHA_MISMATCH` se o commit real no disco do runner divergir do commit SHA aprovado.

### B. Procedimento para Atualizar o Commit Aprovado após Revisão de Código:
Quando uma nova melhoria ou ajuste na infraestrutura de backup for auditado e aprovado pelo conselho técnico:
1. **Obtenção do novo SHA:** Identificar o hash completo de 40 caracteres do commit aprovado na branch (ex.: `git rev-parse HEAD`).
2. **Opção Recomendada — Via GitHub Environment Variable (Zero alteração de arquivos):**
   - Acessar *Settings > Environments > production-backup > Environment variables*.
   - Atualizar a variável `APPROVED_COMMIT_SHA` com o novo hash completo de 40 caracteres.
   - Como o Environment exige **Required Reviewers**, qualquer alteração nas variáveis ou execução do workflow requer autorização manual do revisor designado.
3. **Opção Alternativa — No Repositório:**
   - Atualizar a constante `APPROVED_BACKUP_COMMIT_SHA` em `scripts/production-pooler-connection.mjs` e o fallback no workflow YAML, submetendo novo commit revisado.

---

## 6. Procedimento Operacional em Caso de Divergência de Migrations

Se a execução do workflow for interrompida pelo validador com o erro `REGISTERED_MIGRATION_WITHOUT_FILE`:
1. **Não inventar arquivos e não editar o ledger:** Nunca crie migrations vazias ou fictícias para tentar "burlar" a validação, nem modifique o ledger `supabase_migrations.schema_migrations` na base de produção.
2. **Identificar a migração ausente:** Consulte os logs do step `Run preflight and security checks` ou o arquivo gerado `reconciled-migrations.json` para identificar a versão exata faltante.
3. **Auditoria no Git:** Busque o arquivo correspondente nas branches históricas do repositório (ex.: `git log --all --full-history -- "supabase/migrations/*<versão>*"`).
4. **Checkout e incorporação:** Faça o checkout do arquivo de migration legítimo e adicione-o ao diretório `supabase/migrations/` da branch `codex/m57.2-production-backup-workflow`, garantindo que o checksum e o conteúdo reflitam exatamente a migração aplicada.
5. **Re-executar o workflow:** Após o commit na branch de trabalho, dispare novamente o workflow de backup.

---

## 7. Retenção, Cotas e Limites do GitHub Actions

1. **Cota de Minutos:**
   - Em repositórios públicos, o GitHub Actions oferece execução gratuita ilimitada de runners padrão (`ubuntu-latest` / `ubuntu-24.04`), respeitando o limite de concorrência simultânea.
   - Para consultar o consumo e limites de armazenamento: acesse *GitHub Settings > Billing and plans > Plans and usage*.
2. **Armazenamento de Artefatos:**
   - O artefato publicado (`mk9-production-backup-...tar.gz.gpg`) está configurado com retenção estrita de **1 dia** (`retention-days: 1`).
   - Ele é criptografado com AES-256 antes do upload, eliminando o risco de exposição pública no repositório.
3. **Preservação Durável:**
   - O administrador deve fazer o download do artefato `.zip` pelo painel de Actions em até 24 horas e arquivá-lo em armazenamento seguro e durável (cold storage corporativo ou cofre local).
