# MK9 Date — Missão 29: schema remoto reproduzido em PostgreSQL isolado

**Data:** 22 de outubro de 2026  
**Projeto:** `mk9-data` (`xzmbesqhxcnuokjwrbnw`)  
**Migration:** `20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql`  
**PostgreSQL de teste:** Supabase PostgreSQL `17.11.0.004` em container independente, com diretório de dados em `tmpfs`; sem volume e sem dados de produção.

## Preservação

- Branch `recovery/mk9-date-completo`; `HEAD` e `origin/main` = `54a67bd0d3d9537c2632a8f5b09a664a25eae7ee`.
- Alterações locais anteriores preservadas. Sem branch/worktree, reset, merge, commit, push ou deploy.
- Container temporário `mk9-m29-isolated` foi removido após os testes; tinha `Mounts=[]` e somente `tmpfs`. O container/volume antigo `supabase_db_mk9-date-m25` não foi iniciado, removido ou alterado.
- Nenhuma escrita, migration ou consulta de linhas operacionais foi executada no Supabase remoto.

## Como a reprodução foi obtida

A CLI está vinculada à referência correta. A tentativa de `supabase db dump --linked --schema public,attendance_private` parou antes da conexão com `AccessTokenRequiredError: Access token not provided. Supply an access token by running supabase login or setting the SUPABASE_ACCESS_TOKEN environment variable.` Nenhum dump foi produzido.

Usei as consultas de catálogo somente leitura disponíveis para extrair nomes/tipos/nullability/defaults de colunas, constraints, chaves, policies/RLS, assinaturas, corpos, `SECURITY DEFINER`, `search_path`, ACL, trigger e a definição atual de `attendance_check_in`. Com esses metadados construí uma fixture sintética versionada, sem registros reais, em [mission29_remote_relevant_schema.sql](/C:/projetos/mk9-data/supabase/tests/fixtures/mission29_remote_relevant_schema.sql) e [mission29_remote_current_rpcs.sql](/C:/projetos/mk9-data/supabase/tests/fixtures/mission29_remote_current_rpcs.sql). A estrutura relevante das funções de autorização foi copiada do catálogo, não substituída por permissões permissivas de teste. `auth.uid()` reproduz o corpo remoto; `auth.users` contém somente o contrato de chave `id` usado pelas FKs, sem dados nem o restante do schema GoTrue.

A primeira carga confirmou que a imagem inicializa `auth` no banco `postgres`, mas não no banco novo criado de `template0`. A fixture então criou somente a tabela mínima `auth.users(id,email)` e a implementação catalogada de `auth.uid()`. Os testes revelaram ainda que `supervisores.codigo` e `equipes.codigo` são obrigatórios no remoto. Corrigi os fixtures sintéticos para preencher essas colunas; as constraints foram mantidas.

## Comparação do recorte

| Objeto | Remoto antes da migration | PostgreSQL isolado | Compatível? |
|---|---|---|---|
| 15 tabelas públicas operacionais usadas pela migration/testes | Colunas e tipos consultados, incluindo `visits` com 20 colunas | Mesmo conjunto relevante e tipos; 20 colunas antes da migration | Sim para o recorte de execução |
| `visits` após migration | Esperado: coluna adicional `regularization_status` | 21 colunas, constraint check aplicada | Sim |
| PKs/FKs/uniqueness de visita, rota e evidências | Chaves e constraints relevantes confirmadas em catálogo | Reproduzidas, inclusive unicidade por matrícula/loja/indústria/data | Sim para a migration e os cenários executados |
| Índices primários/únicos usados pela RPC | Pkey e unique occurrence confirmados | Reproduzidos por constraints | Sim para unicidade; não foi feita comparação de cada índice auxiliar não único |
| RLS/policies nas tabelas públicas de visita, rota e evidências | RLS ligada; policies permissivas e restritivas consultadas | Policies de escopo consultadas foram reproduzidas; policies novas da migration apareceram após aplicação | Sim para o recorte público testado |
| `attendance_check_in` antes da migration | Assinatura existente; `SECURITY DEFINER`, `search_path=public, pg_temp`, grant a `authenticated`/`service_role`; bloqueia outra visita aberta sem filtrar data | Definição e ACL relevantes reproduzidas antes da migration | Sim |
| Funções de escopo, autorização e leitura | Corpos/assinaturas consultados; supervisor resolvido por equipe e promotor | Corpos relevantes reproduzidos; decisões admin/supervisor/promotor testadas | Sim para esses casos |
| Trigger `preserve_visit_telemetry` | Definição e evento consultados | Reproduzido antes da migration | Sim para os campos/evidências cobertos |
| `attendance_private` usage, grants de tabelas-base e ACLs RPC | `authenticated` tem usage e privilégios de tabela; ACLs RPC consultadas | Roles Supabase da imagem e grants necessários reproduzidos | Sim para operações SQL testadas; owner das funções ficou `supabase_admin`, enquanto no remoto é `postgres` (ambos superuser) |
| `auth.users` e fluxo Auth/GoTrue | Relação completa existe no remoto | Só chave `id`/`email` e `auth.uid()` remoto | Parcial; login/GoTrue não foi testado |
| `storage.objects` e sua policy de upload | Consulta de catálogo falhou com `Mcp error -32603: Internal error` | Não reproduzidos | Não verificado; afeta validação ponta a ponta da autorização de Storage |
| PostgREST e reload de schema | Projeto remoto tem PostgREST | Não instalado na instância PostgreSQL isolada | Não; RPC foi exercitada diretamente por SQL |
| Objetos não referenciados pelo SQL alvo | Schema remoto mais amplo | Omitidos | Fora do recorte; fixture não é dump completo do projeto |

`lojas.codigo` tem default remoto `generate_store_code()`; a fixture exige código explícito e todos os cenários o fornecem. A geração de código não é chamada pela migration nem pelos testes de regularização. Não foi preciso reproduzir esse helper.

## Pré-condição e aplicação isolada

Antes da aplicação no banco novo, confirmei: ausência de `visits.regularization_status`, `visit_regularization_audit` e `attendance_regularize_visit`; assinatura de check-in presente; definição antiga com o bloqueio global confirmada; schema e policies de dependência criados. A consulta retornou `t|t|t|t|t` para os cinco checks de preflight.

A migration foi enviada integralmente ao banco descartável com `psql -v ON_ERROR_STOP=1`. Criou coluna, tabela e índice de auditoria, funções, grants, policies e triggers; chegou a `COMMIT` sem erro. SHA-256 do arquivo: `02ED53B872D22DB731E2269F5B0673A810B566A8FDB0640400A4CF7E60F4311C`.

## Testes SQL e concorrência

`supabase/tests/visit_regularization.sql` terminou em `ROLLBACK` sem erro, com dados sintéticos. Passaram: encerramento sem comprovação; conclusão administrativa com foto e checklist; auditoria imutável; admin autorizado; supervisor dentro/fora de escopo; negação a promotor; tentativa duplicada; preservação de status, timestamps e linhas de evidência; check-in com visita antiga ainda aberta; retomada idempotente da ocorrência do dia; bloqueio de outra loja ativa no mesmo dia; escala noturna capturada; função de foto bloqueada para visita regularizada e permitida para visita ativa. O ramo de jornada às 02:00 foi validado por assert da expressão de data operacional; o teste de RPC usou a hora real do container, não um relógio injetável.

Foram executados dois pares de sessões `psql` independentes e sobrepostos:

- Check-in: sessão A abriu a visita e manteve a transação/lock; sessão B esperou e foi bloqueada. Resultado final: exatamente uma visita ativa naquele dia (`CHECKIN_CONCURRENCY=t`).
- Regularização: sessão A regularizou e manteve o lock da linha; sessão B esperou e recebeu a rejeição de duplicidade. Resultado final: exatamente um status administrativo e um evento de auditoria (`REGULARIZATION_CONCURRENCY=t`).

Os testes concorrentes usaram `Start-Job` para sessões distintas e verificaram o estado final, não chamadas sequenciais.

## Histórico local/remoto

O ledger remoto continua com 16 versões; a versão `20261022152449` não está aplicada. As 42 migrations locais têm prefixos ausentes e colisões já listados no relatório da Missão 28. Essa divergência **não impediu** criar um banco vazio e aplicar diretamente o SQL alvo na reprodução isolada. Ela ainda impede `db push`/`migration repair` e exige reconciliação antes de qualquer implantação ou registro manual no ledger.

## Frontend e testes da aplicação

- `VISIT_REGULARIZATION_BACKEND_VERIFIED` permanece `false`; confirmação segue bloqueada.
- Serviço usa `attendance_regularize_visit` e converte erros em mensagens para usuário. Resoluções administrativas não entram como visitas operacionais ativas/concluídas.
- `npm run typecheck`: aprovado.
- `npm test`: 421 aprovados, 0 falhas.
- `npm run build`: aprovado; avisos existentes de `__dirname`/Vite e bundle acima de 500 kB.
- `git diff --check`: aprovado.

## Decisão e aplicação

A migration executou sem erro e passou nos cenários SQL e concorrentes contra uma reprodução compatível do recorte PostgreSQL relevante. **Não recomendo ainda a aprovação de ativação em produção:** a policy concreta de `storage.objects` não pôde ser extraída (`Mcp error -32603`) e não foi reproduzida; o schema Auth completo/PostgREST também não foi homologado. A ausência do access token CLI impediu um schema-only dump verificável. Esses limites são específicos e afetam a verificação de autorização/integração de fotos.

Para eventual implantação aprovada: obter acesso schema-only autorizado pelo canal do projeto; comparar especificamente `storage.objects` policy/ACL e objetos de Auth; repetir a fixture/homologação se houver diferença; preservar backup; executar o arquivo inteiro com `BEGIN`/`COMMIT` no SQL Editor em janela aprovada; parar em qualquer erro/estado ambíguo; verificar RPC/ACL/search_path/RLS/auditoria e só então registrar `20261022152449` manualmente sem `ON CONFLICT`. O gate do frontend permanece fechado até validação independente no projeto-alvo. Nenhuma dessas ações remotas foi feita nesta missão.
