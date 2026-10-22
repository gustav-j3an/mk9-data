# MK9 Date — Missão 22: proposta de regularização administrativa de visitas

## Estado desta entrega

Proposta para revisão; não é migration executável e não foi aplicada ao banco. A tela administrativa mostra visitas antigas abertas e suas evidências somente para leitura. O botão de regularização abre a prévia do fluxo, mas não grava alterações. O bloqueio é deliberado: os estados atuais de `visits.status` não representam “encerrada sem comprovação”, e a auditoria atual não audita mudanças em `visits`.

## Estado atual confirmado no repositório

- `visits.status` aceita apenas `pendente`, `em_andamento`, `concluida` e `nao_realizada`.
- `attendance_check_in` serializa check-ins por matrícula com `pg_advisory_xact_lock`, mas bloqueia qualquer outra visita `em_andamento` da matrícula, sem restringir à data operacional. Portanto, uma visita antiga pode bloquear o check-in atual.
- `attendance_private.staff_can_access(matricula)` é o helper de escopo para admin/gestor. A central deve manter a leitura sob as políticas RLS atuais; a interface não concede acesso.
- `promoter_journey_audit` registra jornadas e configurações, não visitas. Não deve ser reaproveitada para este fluxo.
- A tela de acompanhamento filtra visitas regulares pela data selecionada; a central consulta separadamente visitas `em_andamento` com `data_visita < hoje`.

## Modelo proposto

Manter o registro operacional em `visits` sem reescrever check-in, check-out, GPS, fotos, checklist ou status. Adicionar um histórico append-only de decisões administrativas, por exemplo `private.visit_regularization_audit`, com:

- `id`, `visit_id`, `action`, `previous_resolution`, `new_resolution`;
- `visit_status_before` e `visit_status_after` (o status operacional permanece inalterado até existir regra de negócio aprovada);
- `actor_user_id`, `acted_at`, `reason` e `evidence_refs`;
- `evidence_refs` contendo apenas IDs de evidências que já pertençam à visita, validados dentro da transação.

Estados de decisão separados do status operacional: `under_review`, `closed_without_proof` e `administratively_completed`. Uma visão/consulta da fila deve considerar como resolvidas apenas as duas últimas decisões; `under_review` permanece na fila de análise. “Conclusão administrativa” não deve preencher `completed_at` nem tornar a visita operacionalmente concluída. Definir separadamente como os relatórios exibirão essa decisão antes de habilitar o caminho.

## RPC transacional proposta

Criar função em schema privado não exposto, com `search_path = ''`, `auth.uid()` obrigatório e execução revogada de `PUBLIC`/`anon`; conceder apenas a `authenticated`. A função deve:

1. validar perfil ativo com papel `admin` ou `gestor`;
2. bloquear a linha alvo `FOR UPDATE`, confirmar que está antiga e `em_andamento`;
3. validar `attendance_private.staff_can_access(v.promotor_matricula)` para respeitar escopo de gestor;
4. exigir motivo não vazio (mínimo definido pelo produto), ação permitida e confirmação explícita passada pelo cliente;
5. para `administratively_completed`, exigir evidências já anexadas e adequadas segundo critério de negócio formalmente aprovado; nunca criar horário, GPS, foto ou item de checklist;
6. inserir o evento imutável com situação anterior/nova, ator, horário do servidor, motivo e IDs de evidências;
7. deixar `visits` e tabelas filhas inalteradas, retornando resultado da ação; qualquer falha deve reverter toda a transação.

`SECURITY DEFINER` só deve ser usado se necessário para a tabela privada, com schema não exposto, `search_path = ''`, nomes totalmente qualificados e checagens de papel, status, matrícula e escopo dentro da função. Preferir `SECURITY INVOKER` quando grants/políticas permitirem. Não confiar em campos de papel enviados pelo frontend.

## Check-in e fila antiga

Na mesma proposta de backend, ajustar `attendance_check_in` sob o lock já existente para impedir concorrência de check-ins do dia operacional e restringir a busca bloqueadora a visitas ativas daquele dia. Visitas anteriores seguem abertas para a fila administrativa e não são automaticamente modificadas. A regra deve usar a mesma função de data operacional/fuso da RPC atual. Isso precisa ser testado em transações concorrentes; a interface não deve ignorar o erro do servidor.

A consulta da central deve retornar só `status = 'em_andamento'`, data anterior e sem decisão final `closed_without_proof` ou `administratively_completed`; decisões `under_review` continuam visíveis. A RLS/escopo do supervisor permanece fonte de autorização. Não usar matrícula selecionada no cliente como prova de permissão.

## Testes de banco necessários antes de habilitar gravações

- admin autorizado dentro e fora do escopo;
- gestor no escopo e gestor fora do escopo;
- promotor não consegue chamar a RPC nem regularizar a própria visita;
- visita de hoje, visita já concluída e visita não realizada são rejeitadas pela RPC;
- motivo ausente/reduzido e referência de evidência pertencente a outra visita são rejeitados;
- auditoria registra ator autenticado, hora do servidor, motivo, IDs e estados anterior/novo;
- erro na escrita de auditoria reverte a resolução;
- duas requisições concorrentes na mesma visita geram um único estado final consistente;
- visita antiga não bloqueia o check-in do dia, duas visitas ativas do mesmo dia não podem ser iniciadas;
- a regularização não modifica horários, telemetria, fotos, checklist, ocorrências ou validade.

Executar esses cenários em banco local/homologação após revisão da proposta. A suíte de frontend não valida RLS, RPC, atomicidade nem concorrência PostgreSQL.

## Referências técnicas

A orientação atual do Supabase recomenda restringir funções `SECURITY DEFINER`, fixar `search_path` e validar explicitamente o usuário/linhas acessíveis; as políticas RLS continuam sendo parte do limite de segurança. Consulte [Database Functions](https://supabase.com/docs/guides/database/functions) e [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
