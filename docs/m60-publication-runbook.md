# MK9 DATE — procedimento de publicação controlada (Missão 60)

## Estado desta branch

- Base: commit M59 `18c9ae158d63aa4e48f1ee710fdfd80728321337`, branch `codex/m59-structural-fixes`.
- PR #23 continua aberto, base `main`.
- PR #24 continua aberto, base na branch do PR #23.
- A branch M37/M38 que contém as migrations de tentativas e ciclo de vida é `codex/m38-cloud-validation`, commit validado `080ebbb1c70a7eb7716d3f9669039fd127e00123`. Esse conjunto não está em `main`, PR #23 ou PR #24.
- Não foi feita consulta a produção/homologação nem escrita em banco nesta missão.

## Objetos das visitas e origem

| Objeto ausente em produção | Migration canônica | Dependência / observação |
|---|---|---|
| `public.visits.scheduled_date` | `20261023142837_promoter_scheduled_visit_actions.sql` | Pressupõe as RPCs de check-in, `rotas.encerrada_em`, configurações operacionais e permissões de Storage/Auth já presentes. Cria também `visit_schedule_actions`, RPCs e índice parcial. |
| `attempt_number`, `occurrence_root_visit_id` | `20261108170619_m38_retry_attempt_history.sql` | Requer `scheduled_date`, `visit_schedule_actions` e o fluxo M37 de recuperação integral. Adiciona constraints, tabela privada de autorização, índice e dois triggers. |
| `expire_old_visits_before_promoter_checkin` | `20261108130000_m38_visit_cancellation_and_day_end_close.sql` | Exige `pg_cron` habilitado; cria auditoria, funções de fechamento e trigger de expiração. |
| `guard_scheduled_visit_attempt_insert`, `guard_scheduled_visit_attempt_identity_update` | `20261108170619_m38_retry_attempt_history.sql` | As funções são privadas, `SECURITY DEFINER`, e não devem ter execução direta concedida a papéis da API. |
| `trg_visit_promotor_update_integrity` | Origem histórica `20261011120000_create_promoter_authorizations.sql`; redefinido/recriado por `20261108130000_m38_visit_cancellation_and_day_end_close.sql` | A migration M38 instala a validação atual de integridade. Não reaplicar a migration histórica isoladamente sem comparar policies, funções e grants que ela também modifica. |

Os triggers `guard_visit_regularization_update` e `preserve_visit_telemetry` são comuns aos dois ambientes. O teste integrado exige os seis triggers esperados e confere os bindings dos quatro divergentes.

O código em `main` usa `scheduled_date` em `src/utils/routePlanner.ts` e `src/views/PromoterPortalView.tsx`; a ausência dessa coluna em produção é uma incompatibilidade com o código publicado. `attempt_number` e `occurrence_root_visit_id` pertencem ao código M38 ainda não integrado em `main`; não devem ser descritos como requisito do frontend atual até a integração desse conjunto.

## Ordem de integração Git

1. Revisar e integrar o PR #23 em `main`.
2. Depois que #23 estiver em `main`, retargetar o PR #24 de `codex/m58.6.4-disposable-pg17-identity` para `main`, aguardar todos os checks e integrar #24.
3. Revisar em PR próprio o conjunto de migrations e código M37/M38 do commit `080ebbb1c70a7eb7716d3f9669039fd127e00123`. Ele ainda não está em `main`; não executar suas migrations antes dessa revisão e da publicação do código compatível.
4. Integrar o PR desta Missão 60 por último, retargetando-o para `main` após #24. O PR M60 contém apenas validação integrada e este procedimento; não substitui a integração M37/M38.
5. Confirmar que a publicação automática de `main` terminou e que o artefato servido corresponde ao SHA aprovado. Não usar preview como prova de publicação.

Não integrar PR algum antes de seus testes obrigatórios passarem. Nenhum merge ou deploy é autorizado por este runbook.

## Pré-condições antes de qualquer alteração remota

1. Aprovação explícita da janela de manutenção e de uma pessoa responsável pela execução.
2. PRs e checks acima integrados; confirmar SHA de `main` e inexistência de outro deploy concorrente.
3. Usar CLI Supabase fixada na versão 3.0.0 e selecionar explicitamente o projeto de produção `xzmbesqhxcnuokjwrbnw`. Repetir o processo de forma independente para homologação `tafjceemuetqjyngresg`.
4. Gerar backup gerenciado/PITR antes da mudança, registrar horário, SHA e identificador do backup e confirmar que a restauração foi ensaiada em projeto descartável. Guardar credenciais fora de argumentos, logs e arquivos do repositório.
5. Executar inventário somente de leitura de migrations locais/remotas, colunas, constraints, índices, triggers, definições de funções, ACLs, policies/RLS, dependências e jobs `pg_cron`. Exportar os resultados de catálogo e compará-los com as migrations abaixo. Não selecionar linhas comerciais ou pessoais.
6. Validar duplicidades apenas por consultas agregadas, sem imprimir identificadores ou valores comerciais. Em particular, confirmar que os índices únicos que as migrations vão criar/recriar não falhariam.
7. Confirmar que o ledger contém os pré-requisitos históricos e que as seis versões listadas abaixo são as únicas versões históricas ausentes; as novas migrations da sequência planejada são pendências esperadas. Se houver qualquer outra divergência, parar e atualizar o plano antes de executar DDL.

## Reconciliação do ledger histórico

Versões investigadas: `20261009144200`, `20261010`, `20261011120000`, `20261011140000`, `20261017120000`, `20261017`.

| Versão | Evidência conhecida | Classificação atual |
|---|---|---|
| `20261009144200` | Adiciona unicidade em `(promotor_matricula, loja_codigo, industria_codigo, data_visita)`. A auditoria anterior encontrou constraint histórica na produção e ausência na homologação. | **Reconciliação bloqueada** até comparar `pg_get_constraintdef`, validade e índice equivalente em cada ambiente. Não reaplicar DDL. |
| `20261010` | Cria `system_settings`, auditoria e RPC de alteração. | **Reconciliação bloqueada** até comparar colunas, constraints, policies, corpo/ACL da RPC e migrations posteriores. |
| `20261011120000` | Cria autorizações, policies e `trg_visit_promotor_update_integrity`; o trigger falta em produção. M38 redefine esse trigger. | **Estrutura incompleta na produção; substituição posterior parcial comprovável** após M38. Só reparar o ledger depois de verificar todos os demais objetos desta versão. |
| `20261011140000` | Origina o sequence/geradores/triggers de código industrial. Produção não tinha esses objetos. | **Substituída funcionalmente** pela migration forward-only M59. Reconciliar somente depois de M59 aplicado e objetos/ACLs confirmados em cada ambiente. |
| `20261017120000` | Origina tabela, funções e triggers de contratos. Os objetos principais existem; há divergência de ACL confirmada. | **Incompleta até M59**; depois da correção, ainda exige comparação das definições e policies antes de marcar aplicada. |
| `20261017` | Define policies do bucket `avatars`; policies foram encontradas na auditoria. | **Reconciliação bloqueada** até comparar exatamente `qual`, `with_check`, papéis e grants do Storage. |

A aprovação de uma versão é independente: reparar apenas versões cujo objeto completo ou substituição esteja comprovado. Não executar `db push` enquanto uma versão histórica não resolvida ainda puder ser interpretada como DDL pendente.

Procedimento, após aprovação e preflight: executar `supabase migration list --remote`; para cada versão comprovada, usar `supabase migration repair <versão> --status applied --remote`; depois repetir a listagem e registrar diff/saída. `migration repair` altera somente o histórico, não executa nem reverte SQL. Versão sem evidência suficiente fica pendente e bloqueia `db push`.

## Ordem exata das migrations de estrutura

Só depois da integração dos códigos correspondentes, do backup e do preflight:

1. `20261023142837_promoter_scheduled_visit_actions.sql` — já está no histórico versionado. Aplicar apenas se a comparação confirmar que suas tabelas, policies, funções e índices podem ser instalados sem duplicar definições existentes. Corrige `scheduled_date` e outros objetos necessários ao código M37.
2. `20261105165500_m30_harden_industry_active_checkin.sql`.
3. `20261106131614_m30_serialize_industry_checkin.sql`.
4. `20261106140000_m37_pending_visit_active_route_guard.sql`.
5. `20261106150000_m37_checkin_route_and_conflict_guard.sql`.
6. `20261107140000_m37_reconcile_materialized_pending_recovery.sql`.
7. `20261108100000_m37_integral_weekly_recovery.sql`.
8. `20261108130000_m38_visit_cancellation_and_day_end_close.sql` — somente com `pg_cron` habilitado e depois das dependências M37; cria a expiração e recria a integridade de atualização do promotor.
9. `20261108170619_m38_retry_attempt_history.sql` — depois de `scheduled_date` e recuperação integral; adiciona tentativas e suas proteções.
10. `20261108174150_m38_checkin_reuses_active_scheduled_attempt.sql` — por último no bloco M37/M38; exige a migration M37 integral e o índice de tentativas.
11. `20261113190000_m59_contract_acl_and_industry_codes.sql` — hardening dos contratos e gerador de códigos. O teste integrado desta branch aplica M59 após M37/M38 na mesma instância PostgreSQL 17.

Não executar manualmente versões antigas já representadas por estrutura existente. As seis versões históricas acima são reconciliadas no ledger antes do `db push`; o CLI então aplica somente migrations realmente novas e pendentes, na ordem de timestamp.

## Backup, execução e recuperação

- Não executar o bloco inteiro sem pausa. Aplicar uma migration por vez com lock/statement timeout, guardar saída sem credenciais, e inspecionar imediatamente os objetos especificados abaixo.
- Para alteração de ledger, parar se o conjunto de versões locais/remotas mudar durante a janela.
- Para DDL falhar: não prosseguir para a próxima migration e não marcar a versão aplicada. Capturar erro, validar transação/estado do catálogo e restaurar do backup aprovado apenas se o estado estiver inconsistente e a recuperação tiver sido autorizada. Preferir correção forward-only revisada; não inventar rollback que apague dados/auditoria.
- Encerrar a janela se houver lock timeout, constraint inválida, cron ausente, trigger/policy ausente, ACL inesperada, divergência de contagem estrutural, erro PostgREST ou qualquer alteração em linha preexistente não explicada.

## Verificações por etapa

| Etapa | Verificação de catálogo/funcional |
|---|---|
| `20261023142837` | `scheduled_date` nullable; `visit_schedule_actions`, índice parcial, RPCs, ACLs e RLS/policies com definições esperadas. Confirmar leitura/escrita da agenda. |
| M30/M37 | Definições/ACLs das RPCs de check-in, guards de rota/conflito, índices e policies; check-in permitido em rota ativa e negado em rota encerrada/conflitante. |
| M37 integral | Recuperação de todas as ocorrências elegíveis sem reabrir/alterar visita histórica; novas tentativas são novas linhas. |
| M38 lifecycle | `pg_cron` e job esperado; trigger de expiração e auditoria imutável; cancelamento e fechamento diário não sobrescrevem checkout/evidências antigas. |
| M38 attempts | Tipos/nullability/default das duas colunas, checks, FK, índice único por tentativa, dois triggers privados; tentativas concorrentes sequenciais, repetição idempotente e retomada da tentativa ativa. |
| M59 | ACL efetiva e direta das três funções de contrato, RLS existente, sequence após maior código existente, trigger de geração, unicidade e código inválido rejeitado. |
| Ao final | `npm test`, typecheck/build do SHA publicado; testes sintéticos de check-in/out, recuperação, cancelamento, tentativas, evidências e leitura do histórico. Não criar nem consultar registros reais como teste. |

O teste integrado M60 usa GitHub Actions em PostgreSQL 17 descartável: executa o harness M37/M38 no commit fixado acima, aplica a migration M59 na mesma instância e valida objetos/ACLs, bootstrap após código alto existente, rejeição de código inválido/duplicado e geração concorrente. Nenhuma credencial ou URL de Supabase remoto é aceita pelo script.

## Critérios para liberar a publicação

Liberar somente quando: PRs e migrations de runtime estiverem em `main`; as seis versões históricas tiverem decisão e evidência individual; preflight de produção/homologação confirmar dependências, índices e ausência de duplicidades; backup tiver restauração ensaiada; Actions integrada passar; a publicação de código concluir; e testes pós-publicação de check-in/out, recuperação, cancelamento e histórico passarem. Qualquer falha interrompe a sequência no primeiro ponto, preserva o backup e mantém sem alteração o ledger das etapas ainda não aprovadas.
