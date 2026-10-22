# MK9 Date — Missão 28: homologação final e preparação da ativação

**Data:** 22 de outubro de 2026  
**Projeto auditado:** `mk9-data` (`xzmbesqhxcnuokjwrbnw`)  
**Modo:** leitura remota; nenhuma alteração remota ou aplicação de migration.

## Git e preservação

- Branch `recovery/mk9-date-completo`.
- `HEAD` = `origin/main` = `54a67bd0d3d9537c2632a8f5b09a664a25eae7ee`.
- Permanecem as modificações e arquivos não rastreados das missões anteriores, preservados integralmente. Sem branch/worktree, reset, merge, commit ou push.
- Os quatro comandos de build/testes não modificaram arquivos de código. O build produz `dist/` pelo script existente.

## Reconciliação do remoto

O ledger remoto tem 16 versões: `20260930`, `20261001`, `20261006`, `20261007`, `20261008`, `20261015100000`, `20261016100000`, `20261018220000`, `20261018230000`, `20261018232256`, `20261018234153`, `20261019001109`, `20261019001848`, `20261019004947`, `20261019011832`, `20261019013007`.

O diretório contém 42 arquivos SQL e 31 prefixos. Há 15 prefixos locais sem correspondente no ledger (`20261009144200`, `20261010`, `20261011120000`, `20261011140000`, `20261017`, `20261017120000`, `20261018150000`, `20261018235500`, `20261019151754`, `20261019175853`, `20261020160000`, `20261020170000`, `20261021100000`, `20261021120000`, `20261022152449`). Existem arquivos múltiplos/prefixos colidentes em `20260930`, `20261006`, `20261007`, `20261008` e `20261020160000`. Um prefixo do ledger não prova qual dos arquivos locais com o mesmo prefixo gerou o estado atual. Objetos presentes também não permitem inferir com segurança qual migration os criou.

**Classificação das dependências relevantes da migration:**

| Dependência/estado | Classificação | Evidência de catálogo |
|---|---|---|
| `visits`, `rotas`, tabelas de fotos, checklist, ocorrências e validade | Confirmada no remoto | Colunas, tipos, nullability, constraints e índices consultados |
| `profiles`, `promotores`, `supervisores`, `equipes`, `system_settings`, `industrias`, `lojas`, `promoter_work_schedules`, `auth.users`/`auth.uid()` | Confirmada no remoto | Existência e colunas relevantes consultadas |
| Unicidade da ocorrência `(promotor_matricula, loja_codigo, industria_codigo, data_visita)` e chaves da rota | Confirmada no remoto | Constraint/índice únicos e FKs consultados |
| RLS em visitas, rotas e tabelas de evidência; políticas permissivas legadas e restritivas de escopo/fotos | Confirmada no remoto | `relrowsecurity=true`; expressões de políticas inspecionadas |
| `staff_can_access`, `is_admin_or_gestor`, `get_auth_promotor_matricula`, `is_promotor_authorized`, trigger `check_visit_promotor_update_integrity` | Confirmada no remoto | Catálogo de funções/trigger consultado |
| `visits.regularization_status`, `visit_regularization_audit`, `attendance_regularize_visit` | Ausente no remoto | Catálogo de colunas, tabelas e funções não os encontrou |
| Helpers `is_visit_in_current_operational_day`, `is_visit_from_an_earlier_operational_day`, `promoter_can_write_visit` | Ausentes no remoto antes da migration | `to_regprocedure` retornou inexistente; são definidos pela migration alvo |
| RPC remota `attendance_check_in` | Divergente do SQL alvo | É `SECURITY DEFINER`, `search_path=public, pg_temp`, concedida a `authenticated`/`service_role`; mantém lock advisory e unicidade, mas bloqueia qualquer visita `em_andamento` da matrícula independentemente da data e não filtra regularização |
| Correspondência arquivo por arquivo entre as 42 migrations locais, ledger e objetos remotos | Não verificada/ambígua | Colisões de prefixo e migrations ausentes; não é seguro reparar ou marcar versões por inferência |

As constraints, índices e policies das tabelas relevantes foram consultadas sem selecionar dados de pessoas ou visitas. O projeto usa `[db.migrations] enabled = false`, coerente com o histórico divergente e o procedimento assistido já registrado na Missão 26. Não executar `db push`, `migration up`, `db reset` ou `migration repair`.

## Homologação PostgreSQL e limite de fidelidade

O container isolado retido da Missão 25 está parado e preserva seu volume. Ele contém a cópia local das 42 migrations usada anteriormente, com a migration alvo já aplicada; portanto não é um baseline limpo que reproduza o remoto. Reutilizar essa cópia para reaplicar a migration seria uma falsa prova e pode mascarar dependências ausentes.

Não foi criado um clone compatível nesta missão. Os catálogos remotos demonstram diferenças materiais (em especial o corpo/ACL da RPC de check-in, a ausência de objetos alvo, as políticas legadas e as funções instaladas). Uma montagem sintética só com nomes/colunas não reproduziria com fidelidade o estado de triggers, ACL, policies, owners, extensões, schemas auxiliares e integrações `auth`/Storage/PostgREST. A ferramenta remota disponível oferece consultas SQL de leitura, não um dump/restore isolado verificável dessas definições. Não foram copiados dados reais.

Por esse motivo, a migration **não foi executada no PostgreSQL isolado nesta missão**, e os dez cenários SQL da Missão 28 e a concorrência em duas sessões não estão homologados contra um schema compatível com o remoto. A aprovação de implantação deve parar neste ponto. O SQL de regressão local existente continua sendo cobertura útil da cópia M25, mas não satisfaz esta exigência de fidelidade.

## Frontend

- `VISIT_REGULARIZATION_BACKEND_VERIFIED` segue `false`; UI e serviço bloqueiam a confirmação.
- O serviço chama `attendance_regularize_visit(p_visit_id, p_action, p_reason)` e valida motivo não genérico. Erros são convertidos em mensagens de interface; não expõe detalhes SQL crus.
- Visitas com `regularization_status` não são tratadas como ativas/retomáveis; as resoluções administrativas são contabilizadas em categorias próprias e não como conclusão operacional. O Portal distingue resolução de status de atendimento.
- O backend remoto continua antigo; o frontend não deve ser desbloqueado.

## SQL e procedimento preparado — não executar

**Arquivo exato:** `supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql`  
**SHA-256:** `02ED53B872D22DB731E2269F5B0673A810B566A8FDB0640400A4CF7E60F4311C`.

Aplicação pretendida somente após aprovação e homologação compatível: executar o arquivo completo, sem edição ou recorte, no SQL Editor do projeto aprovado. O arquivo contém `BEGIN`, `SET LOCAL lock_timeout='3s'`, `SET LOCAL statement_timeout='60s'` e `COMMIT`; DDL, funções, grants, RLS, policies e triggers ficam na mesma transação. Não usar `db push`.

Pré-condições: staging fiel ao schema remoto; backup restaurável e captura das definições anteriores de `attendance_check_in`, `attendance_check_out`, trigger de integridade e helpers/storage; janela de baixo uso; confirmar referência do projeto, ausência dos objetos alvo e inexistência da versão alvo no ledger; validar permissões/capacidade de lock e obter aprovação operacional.

Se a execução falhar antes do commit, confirmar rollback e inspecionar objetos/ledger antes de qualquer tentativa. Se o resultado for ambíguo, não repetir. Depois do commit, verificar coluna, tabela/auditoria, RPCs e funções auxiliares, `SECURITY DEFINER`, `search_path`, ACL, RLS, policies, trigger, constraint/índice e corpo da RPC de check-in. Executar smoke tests apenas com identidades/dados sintéticos em staging, cobrindo as dez situações solicitadas e concorrência com duas sessões independentes. Parar diante de qualquer diferença, erro de permissão, lock timeout, objeto inesperado ou resultado de teste divergente. Não habilitar a flag do frontend até aprovação independente.

Somente após confirmar a aplicação integral e as verificações posteriores, a proposta de registro manual no ledger é:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261022152449', 'mk9_date_visit_regularization_and_checkin_scope');
```

Não usar `ON CONFLICT`; se existir linha/conflito, interromper e reconciliar. Não executar esse INSERT nesta missão.

Recuperação: antes do commit, deixar a transação reverter e verificar; depois do commit, não há rollback destrutivo preparado. Manter o gate fechado e preferir correção forward revisada, preservando auditorias e evidências. Riscos principais: locks em tabelas de visitas/evidências, políticas permissivas legadas combinadas com as novas policies, incompatibilidade de funções/assinaturas e divergência entre migration ledger e schema. Backup prévio é obrigatório.

## Testes da aplicação

- `npm run typecheck`: aprovado.
- `npm test`: 421 aprovados, 0 falhas.
- `npm run build`: aprovado; avisos do Vite sobre `__dirname`/config loader e bundle acima de 500 kB.
- `git diff --check`: aprovado.

## Conclusão

O schema remoto tem a maior parte das dependências estruturais confirmada e a migration alvo ainda não foi aplicada. A RPC atual diverge justamente na regra que esta migration corrige. Porém, devido ao ledger ambíguo e à ausência de um staging/clone que reproduza o schema real e seus controles, a homologação PostgreSQL solicitada não foi concluída. A implantação **não pode ser submetida à aprovação final** nem ativada; primeiro é necessário obter dump de schema/roles/triggers/policies do projeto por canal autorizado e restaurá-lo em staging isolado, ou staging Supabase aprovado com schema equivalente, então aplicar e testar a migration e concorrência. Nenhum acesso de escrita remoto foi usado.
