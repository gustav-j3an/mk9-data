# RC1.25.43 — preparação de produção (pacote bloqueado)

## Veredito

**Produção não está liberada para execução.** Foi feito o diff read-only de produção xzmbesqhxcnuokjwrbnw contra homologação tafjceemuetqjyngresg, e foi criado um SQL de pré-validação somente leitura. Não foi produzido um DDL consolidado confiável para aplicação porque ainda faltam duas condições mandatórias: ensaio em cópia isolada PG17 com dados equivalentes e prova de backup íntegro/recuperável. Não executar o preflight como migration; ele termina em ROLLBACK e contém zero DDL.

Nenhuma escrita foi feita em produção ou homologação; não houve Actions, merge ou deploy.

## Estado observado via Supabase MCP

| Item | Produção | Homologação |
|---|---|---|
| PostgreSQL | 17.11.0.002 / 17.11 | 17.11.0.003 / 17.11 |
| pg_cron | 1.6.4 | 1.6.4 |
| Ledger | 17 versões; exatas: 20260930, 20261001, 20261006, 20261007, 20261008, 20261015100000, 20261016100000, 20261018220000, 20261018230000, 20261018232256, 20261018234153, 20261018235500, 20261019001109, 20261019001848, 20261019004947, 20261019011832, 20261019013007 | 58 versões, incluindo M30/M37/M38, RC1.25 (20261115160000) e RPC (20261118172125) |
| visits | 43 linhas; sem scheduled_date, attempt_number, occurrence_root_visit_id; possui regularization_status e work_schedule_id | 19 linhas; três colunas M37/M38 presentes (scheduled_date date NULL, attempt_number smallint NOT NULL DEFAULT 1, occurrence_root_visit_id uuid NULL) |
| visit_checklist_items | 135 linhas; sem updated_at e sem UNIQUE (visit_id,item_key) | 25 linhas; updated_at timestamptz DEFAULT now() e uq_visit_checklist_item (visit_id,item_key) |
| visit_photos | 41 linhas, RLS ativo | 2 linhas, RLS ativo |
| visit_regularization_audit | 5 linhas, já presente e RLS ativo | 1 linha, já presente |
| visit_schedule_actions / ciclo M38 | ausente | presente (10 linhas); tabelas de autorização privada presentes |
| Objetos RC1.25 | industria_skus, visit_sku_stock_checks, visit_edits_audit_log ausentes | presentes; contadores observados em zero no ensaio |
| Funções | check-in, checkout e check_visit_promotor_update_integrity() existem, mas suas definições divergem do staging; RPC de edição ausente | attendance_start_scheduled_occurrence, retry/cancelamento, guard SKU e RPC de edição presentes |

A contagem de ledger não é equivalência de schema: a produção contém regularization_status e visit_regularization_audit mesmo sem as versões-base correspondentes no ledger. Isso é drift real; não inserir versões históricas artificialmente.

### Diferenças de segurança relevantes

- visits em produção tem a constraint antiga visits_promotor_loja_industria_data_unique; M37/M38 troca esse modelo por índices parciais para separar visitas regulares de tentativas programadas, mantendo a unicidade diária. Essa remoção/recriação exige ensaio de dados e validação exata.
- Políticas de visits e visit_checklist_items divergem. A policy legacy de escrita do checklist em produção aceita um escopo mais amplo que o guard de status em homologação; não copiar policies por nome sem comparar definições e grants efetivos.
- O staging, sozinho, não reproduz o estado dos dados de produção: visitas 19 vs 43; checklist 25 vs 135; fotos 2 vs 41; auditoria de regularização 1 vs 5. Portanto, ensaios sintéticos anteriores não provam migração segura sobre os dados históricos reais.

## Matriz de fontes e efeitos indispensáveis

| Migration fonte | Efeitos usados no pacote | Situação em produção / decisão |
|---|---|---|
| 20261105165500_m30_harden_industry_active_checkin.sql | valida indústria ativa no check-in | dependência do comportamento alvo; função atual diverge |
| 20261106131614_m30_serialize_industry_checkin.sql | serialização/conflito de check-in; base comentada por M37 | ausente no ledger de 17; precisa ser incorporada/reconciliada |
| 20261023142837_promoter_scheduled_visit_actions.sql | visits.scheduled_date, visit_schedule_actions, start de ocorrência | colunas/tabela ausentes em produção |
| 20261106140000_m37_pending_visit_active_route_guard.sql | substitui função de início agendado | dependência transitiva de M30 |
| 20261106150000_m37_checkin_route_and_conflict_guard.sql | substitui attendance_check_in | produção possui definição diferente |
| 20261107140000_m37_reconcile_materialized_pending_recovery.sql | autorizações de recuperação + trigger de identidade/materialização | ausentes em produção |
| 20261108160835_m37_integral_weekly_recovery.sql | índices parciais e recuperação semanal; mantém trava diária | substitui unicidade antiga; risco de dados |
| 20261110150000_m38_visit_cancellation_and_day_end_close.sql | lifecycle audit/auth, expiração, cancelamento, fechamento e cron | ausente em produção; requer pg_cron 1.6.4 |
| 20261110160000_m38_retry_attempt_history.sql | attempt_number, raiz, auth single-use, guards e retry | ausente em produção |
| 20261110170000_m38_checkin_reuses_active_scheduled_attempt.sql | integra tentativa ativa ao check-in | patch estrutural sobre definição M37/M30 |
| 20261115160000_rc1_25_skus_and_stock_audits.sql | tabelas SKU/estoque/auditoria, guard/finalização, checklist unique/update_at e RPC base | ausente em produção; no staging |
| RPC corrigida da RC1.25.42 | diff canônico server-side + checked, duplicidade pós-trim e ACL anon revogada | versão corrigida aprovada estaticamente; não foi reaplicada/testada na mesma versão final em DB |

As migrations base 20261022152449 e 20261030160000 não devem ser reaplicadas cegamente: parte do resultado já existe em produção e as duas fontes sobrepõem objetos. O delta deve ser derivado de definições completas do catálogo, não de concatenação de arquivos nem de IF NOT EXISTS mecânico.

## Backup e recuperação

**Status do backup recuperável: não comprovado.** As ferramentas Supabase MCP disponíveis nesta sessão não listam snapshots/backups nem comprovam download, integridade ou restore. O backup criptografado citado anteriormente não teve bytes/passphrase recuperados; não se verificou se continua atual, completo ou restaurável. Não afirmar que há backup válido.

Pré-condição antes de qualquer DDL: confirmar pelo painel/fluxo autorizado a data/escopo do backup, export completo dos dados e Storage relevante, checksums, acesso à chave por cofre aprovado e ensaio de restore em banco isolado PG17. O plano Free/limite de compute e a ausência de runner PG17 gratuito foram limitações previamente reportadas; custo zero e cópia com dados reais não estão demonstrados aqui.

Recuperação:
1. Se a transação SQL falhar antes do COMMIT, confirmar rollback completo e ledger inalterado.
2. Se houve COMMIT com erro pós-aplicação, parar tráfego/alterações relacionadas e não repetir a migration.
3. Comparar ledger e catálogo real; preservar logs e evidências.
4. Restaurar snapshot comprovadamente anterior apenas mediante aprovação do administrador e janela acordada; caso não seja possível, aplicar migration compensatória revisada. Não editar/remover histórico do ledger para simular rollback.
5. Revalidar contagens, RLS, functions/triggers, Storage e aplicação antes de retomar.

## SQL do pacote

RC1.25.43_production_preflight_BLOCKED.sql verifica somente versão PG, pg_cron, o conjunto exato das 17 versões e o baseline, e mostra contagens/objetos. Inclui SET TRANSACTION READ ONLY e ROLLBACK. **Não contém DDL, não insere ledger e não é a migration incremental solicitada.** O DDL consolidado fica bloqueado até a matriz object-level ser completada e um ensaio isolado em dados reais/cópia recuperável comprovar a ordem, backfill/defaults, constraints, funções, triggers, ACLs e policies sem perda.

Não se executou parser PostgreSQL, restore, testes de migração em produção ou homologação nesta missão.

## Plano de implementação após liberar as pré-condições

1. Usar novo arquivo único de migration com versão própria, preservar a lista histórica de 17 versões e acrescentar somente uma nova linha de ledger que corresponda a todo o conteúdo consolidado. Não registrar individualmente migrations antigas parcialmente aplicadas.
2. Incorporar M30/M37/M38 em ordem sem modificar nem truncar visitas, fotos ou checklist; novas colunas: scheduled_date nullable sem backfill inventado; attempt_number default 1; occurrence_root_visit_id nullable; visit_checklist_items.updated_at com default now().
3. Manter a unicidade diária comprovada em homologação. Não retirar o guard diário; aplicar índices parciais apenas após conferir duplicatas e o plano M37/M38.
4. Inserir RC1.25 e RPC corrigida (diff server-side, função SECURITY DEFINER, search_path vazio, rejeição de chaves duplicadas pós-trim, EXECUTE revogado de PUBLIC e anon e restrição do diff ao estado efetivo).
5. Uma transação com preflight de ledger/schema exatos, lock/statement timeout, pós-condições object-level, validação de contagens/invariantes e insert de uma versão nova no ledger só no final; qualquer gate falho aborta antes do commit.
6. Auditar o artefato completo; ensaiar com PG17 e backup de produção restaurado. Recalcular contagens, testar check-in/out, M37 occurrence/recovery, retry diário 23505, cancelamento, SKU guard, RPC audit diff, RLS por role, fotos/Storage e rollback.

## Preview Vercel e publicação

- Após DDL autorizado e validado, criar Preview deployment do commit/branch de release, com variáveis apontando exclusivamente para homologação primeiro; testar fluxo e logs.
- Promover produção só após autorização formal separada, verificando project refs e environment variables novamente.
- Nenhum preview/deploy foi criado nesta preparação.

## Auditoria e status

Pacote preparado para auditoria independente. Parecer final do Copilot pendente. O pacote não é liberado para aplicação; produção, homologação, Actions, main e Vercel permaneceram intactos.

