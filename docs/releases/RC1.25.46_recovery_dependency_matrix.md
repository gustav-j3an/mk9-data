# RC1.25.46 — Recuperação e matriz de dependências

Data da verificação: 2026-11-19. Escopo: inspeção estática do repositório e consultas somente-leitura via Supabase MCP. Nenhuma escrita em produção ou homologação.

## Ambiente recuperado

- Repositório `gustav-j3an/mk9-data`, branch `prep/rc1-25-integration-m31`, HEAD no momento da coleta: `9082b6c51cfe06f49da0361608edc91e24fc4711`; a branch foi posteriormente avançada com este relatório no commit `18daef8c2b009da45c3be691ce1161fc5f700fa6`.
- A árvore de trabalho já tinha quatro arquivos modificados de trabalho anterior; foram preservados sem edição.
- Host: Node v24.20.0, Git 2.56.0.windows.2, GitHub CLI 2.103.3 autenticado como `gustav-j3an`, Supabase CLI 2.121.0. Docker, `psql`, `pg_restore` e `pg_dump` não estão instalados.
- Supabase MCP: produção `xzmbesqhxcnuokjwrbnw`, `ACTIVE_HEALTHY`, PostgreSQL 17.11.0.002, 17 migrations; homologação `tafjceemuetqjyngresg`, `ACTIVE_HEALTHY`, PostgreSQL 17.11.0.003, 58 migrations.

## Fonte RC1.25 de SKUs: localização confirmada

Arquivo versionado: `supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql`.

SHA-256 canônico com LF: `8AAF49416C581EAEAAFC31BDFE7C769CA289C2444577A917FBCC769AECC018F5`. O hash também foi conferido após normalização CRLF→LF. `scripts/safe-rc1-25-apply.mjs` fixa esse arquivo, versão `20261115160000` e o mesmo hash; `docs/MK9_HOMOLOGACAO_MIGRATIONS_INVENTORY.md`, linha de inventário 57, registra a mesma procedência. Uma consulta SELECT ao ledger de homologação nesta execução retornou a linha 57 `20261115160000 / 20261115_rc1_25_skus_and_stock_audits`; a 58ª é `20261118172125` para diff server-side. O auditor não reconsultou o banco; esse estado é evidência MCP reportada por Guts, não revalidação independente. Isso corrige a conclusão anterior de “fonte não localizada”: o arquivo está em `propostas/`, não no diretório plano de migrations.

A migration SKU inclui `updated_at` e `uq_visit_checklist_item`, tabelas de SKUs/conferências/auditoria, policies RLS e guards; ela depende das autorizações e funções operacionais introduzidas em M37/M38. A RPC inicial nela foi posteriormente endurecida pela migration 58.

## Matriz de dependências

| Versão | Papel / objetos | Dependências e efeito na unicidade |
|---|---|---|
| `20261106140000` M37 | Guarda rota pendente e início de ocorrência agendada | Requer campos e ações de agenda anteriores (`scheduled_date`, `visit_schedule_actions`) e protege conflito diário no fluxo de rota. |
| `20261106150000` M37 | Guarda de conflito no check-in | Usa a semântica de rota/agenda. Casos de ocorrência já regularizada/encerrada especificam `23505`; a condição “Another visit is in progress” não define ERRCODE e portanto usa o padrão PostgreSQL `P0001`; validações de autorização usam `42501`. |
| `20261107140000` M37 | Reconciliação de recuperação pendente; autorização de recuperação | Depende do fluxo M37 e registra autorização privada usada pelo start programado. |
| `20261108160835` M37 | Recuperação semanal e transição da unicidade | Remove `visits_promotor_loja_industria_data_unique`; cria índices únicos parciais para visita regular sem agenda, agenda com rota e agenda sem rota. Essa troca exige classificar todas as visitas e preservar guardas de conflito durante a transição. |
| `20261110150000` M38 | Cancelamento, fechamento diário e auditoria de ciclo | Depende de recovery/autorizações M37; cria auditoria e autorização de ciclo de vida, triggers e cancelamento. |
| `20261110160000` M38 | Tentativas e vínculo à raiz | Depende de agendamento e cancelamento M38; adiciona `attempt_number`, `occurrence_root_visit_id`, autorização de tentativa e índice único de tentativa de rota. |
| `20261110170000` M38 | Reuso de tentativa agendada ativa no check-in | Depende dos campos e índice de tentativas da migration anterior. |
| `20261115160000` RC1.25 | Catálogo SKU, estoque e auditoria de edição | Depende do checklist, guards de visita e funções/autorização operacional de M37/M38; cria tabelas/policies/triggers. |
| `20261118172125` RC1.25.42 | RPC `save_completed_visit_edit` com diff canônico | Substitui/fortalece RPC inicial: diff calculado no servidor, chaves normalizadas e sem duplicatas pós-trim, lock/auditoria atômicos, `SECURITY DEFINER`, `search_path` seguro e ACL restringindo execução. |

Os nomes confirmados dos índices de transição incluem `visits_regular_promoter_store_industry_date_unique`, `visits_promoter_route_scheduled_date_unique`, `visits_promoter_store_industry_scheduled_date_unique`; M38 introduz `visits_promoter_route_scheduled_attempt_unique`. A política de uma ocorrência operacional diária deve continuar enforced pelos guards, mesmo com índices que distinguem agendas/tentativas. Homologação já contém essa sequência; produção ainda conserva a constraint legada.

## Estado observado dos schemas

Produção, somente leitura: 43 visitas; nenhuma chave nula nem grupo duplicado na chave legada `(promotor_matricula, loja_codigo, industria_codigo, data_visita)`; constraint UNIQUE legada presente. Ausentes no catálogo de produção os objetos SKU/estoque/auditoria, `visit_schedule_actions`, `visit_lifecycle_audit`, tabelas de autorização alvo em `attendance_private`, colunas `scheduled_date`, `attempt_number`, `occurrence_root_visit_id` em `visits`, `visit_checklist_items.updated_at`, e RPCs/guards M37/M38/RC1.25 indicados no runbook da RC1.25.45. Há objetos físicos históricos fora do ledger; não inferir schema apenas do histórico.

Homologação, somente leitura: consultas SELECT via MCP retornaram ledger 58 e objetos das trilhas presentes, inclusive RPC de diff server-side e funções de cancelamento/recuperação/SKU. Esses valores refletem consultas executadas por Guts; o auditor independente não reconsultou o banco. Não houve comparação de dados linha a linha nem uso de staging para inferir segurança de produção.

## Backup e ensaio: parecer

A documentação oficial informa que backups automatizados de plataforma dependem de plano pago; para Free, recomenda-se `supabase db dump` e armazenamento externo. A ferramenta exige Docker no fluxo documentado e restore usa ferramentas PostgreSQL. Supabase Branching consome compute/armazenamento/egress e não satisfaz custo zero. Fontes: [Database Backups](https://supabase.com/docs/guides/platform/backups), [Branching usage](https://supabase.com/docs/guides/platform/manage-your-usage/branching), [Restore to self-hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

No host recuperado não há Docker nem clientes de dump/restore; a organização tem apenas dois projetos ativos, já ocupados por produção e homologação. Não foi comprovado runner remoto autorizado e gratuito. O backup criptografado #21 não foi descriptografado, validado ou restaurado; não se acessaram segredos. Conclusão: não há neste ambiente um caminho comprovado que gere backup restaurável e ensaie uma cópia representativa sob todas as restrições. MCP foi usado somente para leitura de metadados/SELECT; consultas não demonstram backup ou restore.

## Decisão técnica

**BLOQUEADO para publicação/DDL.** A fonte SKU está agora rastreada e os dados de produção não mostram duplicatas na chave legada, mas isso não prova que a mudança para índices parciais seja segura para todas as classes de visita, nem substitui ensaio restaurado. Próximo gate: obter via canal administrativo autorizado um backup descriptografável e verificável, restaurá-lo em PG17 isolado sem custo não autorizado, ensaiar exatamente a sequência integrada e validar unicidade/guards, RPC, RLS e recuperação. Até lá, sem DDL, ledger, merge ou deploy.

## Referências de código consultadas

- `supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql`
- `supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql`
- `supabase/migrations/20261107140000_m37_reconcile_materialized_pending_recovery.sql`
- `supabase/migrations/20261108160835_m37_integral_weekly_recovery.sql`
- `supabase/migrations/20261110150000_m38_visit_cancellation_and_day_end_close.sql`
- `supabase/migrations/20261110160000_m38_retry_attempt_history.sql`
- `supabase/migrations/20261110170000_m38_checkin_reuses_active_scheduled_attempt.sql`
- `supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql`
- `supabase/migrations/20261118172125_rc1_25_42_server_derived_completed_visit_edit_diff.sql`
