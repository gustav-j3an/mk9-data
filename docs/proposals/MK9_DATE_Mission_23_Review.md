# MK9 Date — Missão 23: contrato da Central de Regularização

## Entrega e gate de ativação

A migration versionada está em `supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql`; os testes sintéticos de banco estão em `supabase/tests/visit_regularization.sql`. Nada foi aplicado. O cliente usa a RPC `attendance_regularize_visit`, mas `VISIT_REGULARIZATION_BACKEND_VERIFIED` permanece `false`; o botão não habilita até implantação e validação no ambiente-alvo.

## Contrato de resolução

`visits.status` continua com os quatro estados operacionais existentes. O novo campo `regularization_status` guarda separadamente uma das decisões finais:

- `closed_without_execution_proof` — não representa atendimento concluído;
- `administratively_completed_with_proof` — exibido como conclusão administrativa separada das conclusões operacionais.

Ambas mantêm `started_at`, `completed_at`, GPS, `status` e evidências originais. A auditoria append-only conserva matrícula, ação, decisão anterior/nova, status operacional anterior/novo, usuário autenticado, hora do servidor, motivo e referências às evidências existentes. A tabela não concede INSERT/UPDATE/DELETE a `authenticated`.

Critério implementado para conclusão administrativa: pelo menos uma foto existente e um item de checklist com `checked = true` ou `valor_texto` não vazio. O servidor valida o critério e captura IDs de fotos, checklist, ocorrências e validades já vinculados à visita. A decisão sem comprovação não exige nem inventa evidências. Se o negócio exigir outro limiar, ele deve ser revisto antes de ativar a migration.

## Autorização, atomicidade e concorrência

A função privilegiada fica em `attendance_private` e valida JWT, perfil ativo, papel admin ou gestor vinculado a supervisor ativo, escopo do supervisor, visita antiga em andamento, motivo e evidências. O wrapper público é `SECURITY INVOKER`; não há `service_role` no cliente. `FOR UPDATE` serializa decisões sobre a mesma visita e `UNIQUE(visit_id)` na auditoria dá uma segunda proteção contra duas decisões finais.

O trigger só aceita mudança em `regularization_status` quando há evento correspondente na auditoria criado pelo mesmo usuário dentro da transação. Check-in e check-out não alteram visitas históricas. Políticas restritivas também impedem o promotor de editar evidências antigas; upload de fotos continua permitido para staff dentro do escopo já autorizado.

## Regra de check-in

`attendance_check_in` conserva o lock consultivo por matrícula e a unicidade existente da ocorrência (`promotor_matricula`, `loja_codigo`, `industria_codigo`, `data_visita`). Agora a verificação de conflito procura outra visita `em_andamento` apenas no mesmo dia operacional calculado pela RPC. Repetição da mesma ocorrência ativa continua idempotente; ocorrência já encerrada é recusada. Check-out e DML direto do promotor recusam visita de dia operacional anterior.

## Contabilização

O Acompanhamento de Visitas apresenta contagens distintas para conclusão operacional, conclusão administrativa com comprovação e encerramento administrativo sem comprovação. O status `concluida` e `completed_at` não são sintetizados. Logo, relatórios existentes que contam apenas `status = 'concluida'` não confundem encerramentos sem comprovação com execuções concluídas; a conclusão administrativa também não é somada à conclusão operacional.

## Validação antes de habilitar

Os testes SQL cobrem perfil admin, escopo permitido/negado de supervisor, negação a promotor, motivo, evidência mínima, auditoria, preservação de telemetria, check-in após visita antiga, repetição da mesma ocorrência e bloqueio de uma segunda visita ativa no dia.

Teste de concorrência em duas sessões ainda precisa ser executado em banco local/homologação: enviar duas regularizações simultâneas para o mesmo `visit_id` e confirmar exatamente um evento e uma resposta de “já regularizada”; em outro caso, iniciar duas ocorrências diferentes simultaneamente para a mesma matrícula/dia e confirmar que apenas uma fica ativa. A suíte JavaScript cobre estados e formatos do cliente, não locks PostgreSQL.

## Ativação

1. Rever o critério de comprovação com o responsável operacional.
2. Iniciar Docker/Supabase local e aplicar migrations somente em ambiente local isolado; executar `supabase test db --local` e o teste de duas sessões.
3. Corrigir qualquer desvio e repetir suíte frontend e build.
4. Aplicar a migration em homologação pelo processo de release autorizado e validar RLS, permissões, histórico e concorrência.
5. Após confirmação de homologação, alterar o gate frontend para ativar a chamada. Esta entrega não executa etapas 2–5.
