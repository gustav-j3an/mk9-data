# MK9 Date — Missão 24: revisão e gate de validação do backend

## Resultado

A migration `supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql` foi revisada e recebeu dois ajustes locais nesta missão: auditoria com trigger contra UPDATE/DELETE e validação de motivo com mínimo de 10 caracteres, normalização de espaços e rejeição de justificativas genéricas. O teste SQL agora começa em transação e termina em `ROLLBACK`, para não deixar fixtures no banco se executado por engano.

Isso não equivale a validação PostgreSQL. A migration não está aprovada para aplicação: ela precisa compilar e passar os cenários em um projeto Supabase local ou de homologação isolado.

## Auditoria e dependências

Branch `recovery/mk9-date-completo`; `HEAD` e `origin/main` são `54a67bd0d3d9537c2632a8f5b09a664a25eae7ee`. O worktree já continha alterações locais de missões anteriores e elas foram preservadas. A migration desta missão é um arquivo local não rastreado; não foi criada branch/worktree, nem houve commit, push, merge ou deploy.

A migration depende de objetos criados antes dela: `public.visits` e tabelas de evidência (01/07 de outubro), `attendance_private.staff_can_access` e políticas de escopo, `public.promoter_work_schedules` com timezone/vigência/turno noturno, `visits.work_schedule_id`, `public.supervisores`, `public.profiles`, `auth.uid()`, e a constraint `visits_promotor_loja_industria_data_unique`. A sequência local contém essas definições em migrations anteriores. Não foi possível consultar a tabela `supabase_migrations.schema_migrations` local ou remota nesta sessão, então o estado aplicado do projeto existente permanece desconhecido.

## Regras revisadas

- A RPC de check-in mantém lock consultivo por matrícula, retorna a mesma ocorrência ativa em repetição e rejeita outra visita ativa na mesma data operacional. A constraint única preserva uma ocorrência por promotor/loja/indústria/data. O filtro não considera visitas antigas; nenhuma visita histórica é encerrada nem tem data/telemetria regravada.
- A regularização exige perfil ativo admin ou gestor vinculado a supervisor ativo, escopo `staff_can_access`, visita antiga ainda aberta, motivo descritivo e, para conclusão administrativa, foto e checklist existentes. `FOR UPDATE` e `UNIQUE(visit_id)` serializam tentativas para o mesmo registro.
- A decisão fica em `regularization_status`; `status`, timestamps, GPS e evidências originais são preservados. As decisões não viram `status='concluida'` nem criam `completed_at`; relatórios operacionais que contam status concluído não as contam como execução. Consultas que contam `status='em_andamento'` sem filtrar a decisão podem continuar exibindo essas linhas como abertas e devem ser revistas antes de qualquer mudança futura na definição operacional.
- A tabela de auditoria concede apenas SELECT a `authenticated`, usa RLS por equipe e agora bloqueia UPDATE/DELETE por trigger. INSERT é feito pela função privilegiada na mesma transação da decisão.
- A função privada usa `SECURITY DEFINER` com `search_path=''`; valida usuário, papel, status, escopo, ação, visita, motivo e prova. O endpoint público usa `SECURITY INVOKER` e apenas `authenticated` recebe EXECUTE. A migration não concede `service_role` ao cliente.

## Frontend

`VISIT_REGULARIZATION_BACKEND_VERIFIED` permanece `false`. O botão Confirmar continua bloqueado; não há detecção automática segura de disponibilidade da RPC no cliente, e uma chamada de regularização não deve ser usada como sondagem. Após migration aplicada e validada, o gate precisa ser liberado em alteração revisável. O motivo é validado no cliente e novamente na RPC; respostas conhecidas são traduzidas para português e erros internos genéricos não são mostrados.

## Validações executadas

- `npm run typecheck`: passou.
- `npm test`: passou, 414 testes e 0 falhas.
- `npm run build`: passou; Vite reportou o aviso existente de `__dirname` e bundle acima de 500 kB.
- `git diff --check`: passou.
- Testes PostgreSQL em `supabase/tests/visit_regularization.sql`: não executados. Docker Desktop não expõe o daemon e não há `psql`, `pg_ctl` ou `postgres` instalados.
- Teste real de duas sessões concorrentes: não executado. O SQL cobre repetição sequencial, perfis/escopo e regressão de check-in, mas isso não prova os locks em concorrência.

Não foi usado banco remoto para testes. A configuração local declara `db.migrations.enabled = false`, e `supabase status` também falhou por indisponibilidade do daemon. Não aplicar a migration nem habilitar o botão antes de uma execução isolada completa, incluindo duas sessões concorrentes.

## Próximas etapas antes de submeter para aprovação

1. Disponibilizar PostgreSQL/Supabase local isolado, habilitar o fluxo local de migrations sem alterar a configuração compartilhada sem revisão e aplicar toda a sequência local.
2. Executar `supabase test db --local` com o teste transacional e corrigir erros de schema/RLS/SQL.
3. Executar dois check-ins concorrentes de ocorrências diferentes para a mesma matrícula/dia e confirmar apenas uma visita ativa; repetir duas regularizações concorrentes para o mesmo `visit_id` e confirmar uma única decisão/auditoria.
4. Confirmar, em dataset sintético, permissões de admin, supervisor dentro e fora do escopo, promotor, evidências e contagens operacionais.
5. Só então preparar a solicitação de aprovação para aplicar no projeto Supabase existente; não usar produção como ambiente de teste.
