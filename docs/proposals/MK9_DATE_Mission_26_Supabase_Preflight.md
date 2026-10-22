# MK9 Date — Missão 26: preflight do Supabase

**Data:** 22 de outubro de 2026

**Escopo:** auditoria somente de leitura e preparação; nenhum comando de escrita foi executado no Supabase remoto.

## Git e preservação

- Branch: `recovery/mk9-date-completo`.
- `HEAD` e `origin/main`: `54a67bd0d3d9537c2632a8f5b09a664a25eae7ee`.
- O workspace já tinha alterações modificadas e não rastreadas de missões anteriores. Foram preservadas.
- Não foram criadas branches/worktrees, nem feitos reset, merge, commit ou push.
- O build atual gera `dist/` conforme o script existente; nenhuma alteração de código foi feita nesta missão.

## Projeto remoto e escopo consultado

O projeto Supabase configurado localmente como `project_id = "mk9-data"` corresponde ao projeto ativo **mk9-data**, ref `xzmbesqhxcnuokjwrbnw`, região `sa-east-1`, PostgreSQL 17.11. A identificação veio da listagem de projetos conectada e foi confirmada pelo catálogo remoto. Nenhuma chave, senha ou string de conexão foi consultada.

As consultas remotas foram somente leitura e limitadas a catálogos, definições de funções, constraints, grants e políticas. Não foram selecionadas linhas de atendimentos, visitas ou pessoas.

## Schema e migration de regularização

O schema remoto tem `visits`, `rotas`, `visit_photos`, `visit_checklist_items`, `visit_occurrences`, `visit_product_validity`, `promoter_work_schedules`, `profiles`, `promotores` e `supervisores`. As colunas usadas pela migration — incluindo `visits.work_schedule_id`, dados de check-in/out, relações de evidências e colunas de perfil/supervisor — estão presentes. Também existem as funções de escopo/autorização exigidas (`attendance_private.staff_can_access(text)`, `public.is_admin_or_gestor()`, `public.get_auth_promotor_matricula()`), e a role `authenticated` tem `USAGE` no schema `attendance_private` e execução da função de escopo.

RLS está habilitada em `visits`, rotas e tabelas de evidência. Foram encontradas políticas permissivas legadas e guardas restritivas de evidência/fotos. Os nomes das novas políticas da migration não colidem com as políticas remotas consultadas. A tabela de auditoria, a coluna `visits.regularization_status`, as funções de regularização e o trigger de guarda ainda não existem no remoto. Portanto, não há indício de aplicação parcial desses objetos.

O check-in remoto atual é `SECURITY DEFINER`, autorizado somente a `authenticated`, e usa identidade do perfil, validação de rota, lock consultivo por matrícula e constraint única da ocorrência. Entretanto, a função atualmente bloqueia qualquer outra visita com `status='em_andamento'`, sem restringir a mesma data operacional. A migration local altera a RPC para ignorar visitas abertas de dias anteriores, continuar bloqueando outra ocorrência ativa no mesmo dia e impedir reexecução da ocorrência fechada. Ela também define `search_path=''` nas RPCs atualizadas e restringe explicitamente seus grants.

A regularização prevista mantém o status operacional original, não fabrica `completed_at` nem altera GPS/check-in/check-out; grava auditoria imutável, usa `FOR UPDATE`, verifica admin ou supervisor ativo e escopo, exige motivo descritivo e exige foto mais resposta de checklist para conclusão administrativa. A auditoria fica legível somente para equipe autenticada no escopo autorizado. Fotos, checklist, ocorrências e validade são referenciados, não reescritos.

## Divergência de migrations

O ledger remoto tem estas 16 versões:

`20260930`, `20261001`, `20261006`, `20261007`, `20261008`, `20261015100000`, `20261016100000`, `20261018220000`, `20261018230000`, `20261018232256`, `20261018234153`, `20261019001109`, `20261019001848`, `20261019004947`, `20261019011832`, `20261019013007`.

A versão alvo `20261022152449` não consta nele. O diretório local contém 42 arquivos SQL e 31 prefixos distintos. Os 15 prefixos locais ausentes do ledger são `20261009144200`, `20261010`, `20261011120000`, `20261011140000`, `20261017`, `20261017120000`, `20261018150000`, `20261018235500`, `20261019151754`, `20261019175853`, `20261020160000`, `20261020170000`, `20261021100000`, `20261021120000` e `20261022152449`. Há colisões locais nos prefixos `20260930`, `20261006`, `20261007`, `20261008` e `20261020160000`. Algumas versões antigas no ledger usam somente `YYYYMMDD` para vários arquivos locais diferentes. O schema remoto contém objetos cuja correspondência com o ledger não pode ser atribuída com segurança apenas pelo nome/versão.

Consequência: não classificar todos os arquivos locais ausentes como simplesmente pendentes; alguns objetos já existem no remoto sem uma trilha de versão inequívoca. `supabase db push`, `migration up`, `db reset` e `migration repair` não são seguros neste repositório sem reconciliação adicional. Não alterar nem reparar o ledger automaticamente.

`supabase/config.toml` tem `[db.migrations] enabled = false`; o comentário do próprio arquivo diz que isso pula migrations em `db push` e `reset`. A configuração é coerente com o histórico legado divergente e com os runbooks locais, que descrevem implantação assistida pelo SQL Editor e registro no ledger somente depois do sucesso. Ela não foi alterada. O seed está habilitado, mas `supabase/seed.sql` não existe; isso é mais um motivo para evitar `db reset`.

## Revisão do frontend

- O serviço chama a RPC `attendance_regularize_visit` com `p_visit_id`, `p_action` e `p_reason`.
- `VISIT_REGULARIZATION_BACKEND_VERIFIED` permanece `false`; o handler e o botão Confirmar regularização bloqueiam a mutação até validação do backend.
- A tela consulta a auditoria apenas quando recebe uma visita regularizada. Como a tabela/coluna ainda não existem remotamente, a regularização segue corretamente indisponível.
- O Portal do Promotor usa a RPC `attendance_check_in`; não há bloqueio artificial de check-in relacionado à migration.
- **Pendência de interface antes da ativação:** `isUnresolvedVisitInProgress` filtra `regularization_status`, mas `isOpenVisitFromToday` em `src/utils/visitCheckInConflict.ts` não o considera. Uma visita regularizada durante uma jornada que cruza a meia-noite pode ter `started_at` na data civil de hoje e `data_visita` de um dia operacional anterior, sendo tratada como ativa pelo portal. Atualizar esse helper e seus testes para ignorar qualquer visita com `regularization_status` antes de liberar a flag.

## Plano preparado — não executar nesta missão

### Pré-condições

1. Corrigir e testar a pendência de interface acima.
2. Fazer reconciliação aprovada do ledger e dos objetos remotos sem registrar versões antigas por suposição. A migration alvo tem versão única e ainda ausente.
3. Confirmar projeto/ref e janela com DBA/admin autorizado; gerar backup completo de dados e dump de schema/roles e guardar definições das funções que serão substituídas.
4. Revalidar ausência da coluna, tabela, RPC e nomes de políticas/trigger imediatamente antes da aplicação. Não prosseguir se qualquer resultado divergir desta auditoria.
5. Aplicar primeiro em staging isolado no estado real do schema e executar testes de permissões, escopo, concorrência e evidências.

### SQL alvo

Executar **o arquivo inteiro, sem recortes ou alterações**, no SQL Editor do projeto aprovado:

`supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql`

SHA-256 revisado: `02ED53B872D22DB731E2269F5B0673A810B566A8FDB0640400A4CF7E60F4311C`.

O arquivo inicia transação, define `lock_timeout = '3s'` e `statement_timeout = '60s'`, e termina com `NOTIFY pgrst, 'reload schema'` e `COMMIT`. Não executar via `db push`. Se o script falhar, parar e confirmar rollback/estado antes de qualquer repetição.

Somente após confirmar o commit integral com sucesso, registrar a versão alvo no ledger (e parar se já houver conflito):

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261022152449', 'mk9_date_visit_regularization_and_checkin_scope');
```

Não usar `ON CONFLICT DO NOTHING`: colisão deve ser investigada, não mascarada. Em seguida, conferir a linha do ledger, coluna/tabela/RPCs, `prosecdef`, `search_path`, ACL, RLS, trigger e políticas; confirmar a definição atualizada de `attendance_check_in` pelo catálogo. Fazer smoke test de leitura e autorização em staging, sem regularização de visitas reais. O gate do frontend só poderá ser habilitado após homologação independente no projeto-alvo.

### Recuperação e riscos

Antes da janela, capturar backup completo, schema e definições anteriores de `attendance_check_in`, `attendance_check_out`, `check_visit_promotor_update_integrity` e `photo_upload_allowed`. Erro antes do commit deve reverter a transação; ainda assim, verificar objetos e ledger antes de retry, pois o SQL Editor pode ter sido executado parcialmente pelo operador. Após o commit, manter o gate frontend fechado se qualquer verificação falhar e preferir correção forward revisada. Não apagar tabela/coluna de auditoria nem registros caso já existam eventos; rollback destrutivo não está preparado.

Riscos operacionais: locks em tabelas de visitas/evidências, bloqueio por mais de 3s em horário movimentado, alteração de RPCs de check-in/check-out e combinação com policies legadas permissivas. Executar em janela de baixo uso e testar gravação de evidências por perfil em staging antes de liberar.

## Testes desta missão

- `npm run typecheck`: aprovado.
- `npm test`: 415 aprovados, 0 falhas.
- `npm run build`: aprovado; avisos existentes de uso de `__dirname` no Vite e bundle acima de 500 kB.
- `git diff --check`: aprovado.
- Não foram executados testes SQL remotos nem escrita no banco. A validação PostgreSQL isolada de 42 migrations e concorrência consta no relatório da Missão 25; não substitui homologação no schema remoto.

## Decisão

Os pré-requisitos estruturais específicos da migration existem no Supabase remoto e os objetos alvo estão ausentes. A compatibilidade estrutural é **promissora**, mas a implantação ainda não deve ser liberada: há divergência histórica ampla, ausência de staging validado sobre o estado remoto e uma pendência concreta no helper de interface para jornada que cruza a meia-noite. O plano pode ser submetido para revisão técnica/administrativa, condicionado a esses bloqueios; não declarar pronto para produção nem habilitar a regularização ainda.
