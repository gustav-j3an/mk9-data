# Plano Operacional de Backup e Recuperação (Disaster Recovery)

**Projeto:** MK9 Date  
**Data:** 19 de outubro de 2026  
**Auditor Responsável:** DBA PostgreSQL Sênior / Engenheiro de Segurança de Dados  
**Documento:** `docs/qa/PLANO_BACKUP_RECUPERACAO_PRESENCA.md`  

---

## 1. Avaliação Real dos Recursos de Backup no Supabase Cloud

A consulta via CLI oficial (`npx supabase backups list`) no projeto remoto vinculado (`xzmbesqhxcnuokjwrbnw`, região `sa-east-1` São Paulo) retornou o seguinte diagnóstico comprovado:

- **Região:** `sa-east-1` (São Paulo).
- **WAL-G (Arquivamento Físico de WALs):** `walg_enabled: true`.
- **PITR (Point-in-Time Recovery):** `pitr_enabled: false` (Não disponível no plano atual).
- **Backups Físicos Automáticos Listados via CLI:** `backups: []` (Acesso direto a snapshots físicos via CLI não disponível no plano atual).

> **Conclusão:** O ambiente de produção **não possui PITR habilitado** e não permite restauração instantânea por snapshot físico via CLI. Portanto, a salvaguarda de dados antes de qualquer migração depende de **Backups Lógicos Completos (Esquema + Dados)**.

---

## 2. Estratégia de Backup Completo Pré-Implantação

Para garantir 100% de recuperabilidade sem perda de promotores, equipes, visitas, rotas e fotos, o procedimento de backup deve abranger:

### A. Exportação Lógica Estruturada (Comandos Propostos para Autorização)

1. **Backup Completo de Dados (Data-Only com COPY):**
   ```bash
   npx supabase db dump --linked --data-only --use-copy -f supabase/backups/prod_backup_data_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql
   ```
   - **Conteúdo Coberto:** Dados reais de `public.promotores` (44), `public.equipes`, `public.supervisores`, `public.visits`, `public.rotas`, `public.lojas`, `public.industrias`, `public.system_settings`, etc.
   - **Segurança:** O arquivo gerado deve ser salvo em diretório seguro e nunca versionado em repositório público.

2. **Backup Completo de Estrutura (Schema-Only):**
   ```bash
   npx supabase db dump --linked -f supabase/backups/prod_backup_schema_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql
   ```

3. **Backup de Roles e Permissões de Cluster:**
   ```bash
   npx supabase db dump --linked --role-only -f supabase/backups/prod_backup_roles_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql
   ```

### B. Salvaguarda via Painel Supabase Cloud
- Acessar o Dashboard: `https://supabase.com/dashboard/project/xzmbesqhxcnuokjwrbnw/settings/database`
- Em **Backups**, acionar a exportação manual diária disponível no painel.

---

## 3. Procedimento Formal de Restauração e Recuperação (Runbook)

### Cenário 1: Aborto Durante a Execução de uma Migration
- **Mecanismo:** Todas as 9 migrações de presença foram estruturadas em blocos atômicos `BEGIN; ... COMMIT;` com timeouts de segurança (`lock_timeout = '3s'`, `statement_timeout = '60s'`).
- **Comportamento:** Se ocorrer qualquer erro de sintaxe, permissão ou concorrência, o PostgreSQL efetua o `ROLLBACK` instantâneo de toda a transação daquele arquivo. Nenhuma tabela parcial é mantida.
- **Ação Imediata:** Interromper o processo; o banco retorna exatamente ao estado anterior.

### Cenário 2: Corrupção Inesperada ou Incompatibilidade Pós-Aplicação
Caso as migrações sejam concluídas mas causem bloqueio em contratos de produção:

1. **Colocar a Aplicação em Modo de Manutenção:**  
   Suspender o tráfego do frontend para evitar inserções concorrentes.
2. **Restauração dos Dados a partir do Dump de Salvaguarda:**
   - Para reverter dados alterados, executar a recarga do arquivo de dados gerado no pré-backup:
   ```bash
   psql -h aws-0-sa-east-1.pooler.supabase.com -p 5432 -d postgres -U postgres.xzmbesqhxcnuokjwrbnw -f supabase/backups/prod_backup_data_<timestamp>.sql
   ```
3. **Validação da Restauração:**
   - Conferir contagem exata de promotores (`44`), equipes (`1`), supervisores (`1`) e visitas.
   - Testar o login e a visualização do painel no frontend.

---

## 4. Limitações Conhecidas de Serviços Satélites

- **Storage (`visit-photos`):** Dumps de banco exportam os registros da tabela `storage.objects` e metadados de `public.visit_photos`, mas não duplicam os arquivos binários JPG/PNG no bucket. Como nenhuma migração apaga objetos do bucket, os binários permanecem seguros no Storage S3 da Supabase.
- **Auth (`auth.users`):** Usuários de autenticação residem no schema privado `auth`. O dump de dados do `public` referencia `auth.users(id)` com integridade referencial mantida.

