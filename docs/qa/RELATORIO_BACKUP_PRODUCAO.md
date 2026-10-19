# Relatório de Execução e Validação do Backup de Produção

**Projeto:** MK9 Date  
**Data da Extração:** 19 de outubro de 2026 às 10:50:35 (UTC-3)  
**Projeto Supabase Cloud:** `xzmbesqhxcnuokjwrbnw` (Região `sa-east-1` São Paulo)  
**Auditor Responsável:** DBA PostgreSQL Sênior / Engenheiro de Segurança de Dados  
**Documento:** `docs/qa/RELATORIO_BACKUP_PRODUCAO.md`  

---

## 1. Sumário Executivo

Em conformidade com a autorização expressa do usuário, a extração do backup completo pré-implantação foi realizada com sucesso.

- **Status Geral:** **100% CONCLUÍDO E VALIDADO**.
- **ExitCode de Todos os Comandos:** `0` (Zero erros na execução).
- **Proteção do Repositório Git:** A pasta `supabase/backups/` e arquivos `.dump`/`.sql` estão rigorosamente protegidos no `.gitignore`. O comando `git status --short` confirma que nenhum arquivo de backup foi indexado.
- **Ambiente de Produção:** **Intacto e inalterado**. O procedimento consistiu exclusivamente em leitura (`pg_dump` via CLI) e desabilitação temporária de triggers para restauração (`SET session_replication_role = replica;`). Nenhuma migration ou SQL de escrita foi executado no Supabase Cloud.

---

## 2. Inventário dos Arquivos de Backup Gerados

| Arquivo de Backup | Finalidade | Tamanho | SHA-256 Checksum |
| :--- | :--- | :---: | :--- |
| `prod_backup_data_pre_attendance.sql` | Dados operacionais reais (`COPY ... FROM stdin`) | 216.569 bytes | `88D6F07D66ED9449AA739A26C3E29C3C55FACB24DD0C40FE54B8B011A5E43B74` |
| `prod_backup_schema_pre_attendance.sql` | DDL completa do esquema de produção | 84.228 bytes | `028A1D43CF9D972A893805BE2E5F3FEF4F3C6B0BA171F912B8A3339CE082D721` |
| `prod_backup_roles_pre_attendance.sql` | Roles e permissões do cluster | 370 bytes | `168A95A9C745AF5ED4679751F90419AC9DC434240A213B03E32A06D5664C2308` |

**Local Seguro:** `C:\projetos\mk9-date\supabase\backups\`

---

## 3. Cobertura Efetiva de Dados Confirmada

A inspeção detalhada do arquivo `prod_backup_data_pre_attendance.sql` confirmou a presença dos blocos de dados `COPY` das tabelas essenciais:

- **Cadastros Operacionais:** `public.promotores`, `public.equipes`, `public.supervisores`, `public.contratos_lojas`, `public.lojas`, `public.industrias`.
- **Roteirização e Campo:** `public.rotas`, `public.visits`.
- **Evidências de Campo:** `public.visit_checklist_items`, `public.visit_occurrences`, `public.visit_photos`, `public.visit_product_validity`.
- **Governança e Autorizações:** `public.profiles`, `public.system_settings`, `public.system_settings_audit_log`, `public.promoter_operation_authorizations`, `public.promoter_operation_authorizations_audit_log`.
- **Serviços Satélites:**
  - `auth`: `audit_log_entries`, `users`, `identities`, etc.
  - `storage`: `storage.buckets`, `storage.objects`.

---

## 4. Limitações Técnicas Declaradas

1. **Arquivos Físicos do Supabase Storage:** O backup inclui todos os metadados de fotos na tabela `storage.objects` e `public.visit_photos`, porém os binários (JPG/PNG) continuam hospedados no bucket S3 da Supabase. Como nenhuma das 9 migrações altera ou remove arquivos do bucket, os binários permanecem seguros.
2. **Reversibilidade:** Em caso de necessidade de rollback completo, o arquivo `prod_backup_data_pre_attendance.sql` está formatado com `SET session_replication_role = replica;`, permitindo reimportação sem conflito de triggers ou foreign keys temporárias.

