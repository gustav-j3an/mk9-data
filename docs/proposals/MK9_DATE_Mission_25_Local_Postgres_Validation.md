# MK9 Date — Missão 25: validação local de regularização

## Ambiente e isolamento

Na auditoria inicial, branch `recovery/mk9-date-completo`, `HEAD` e `origin/main` em `54a67bd0d3d9537c2632a8f5b09a664a25eae7ee`; alterações locais preexistentes preservadas.

Docker Desktop estava instalado e seus processos ativos. O histórico recente do log registrava erros transitórios de inicialização WSL/engine (Virtual Machine Platform e distro `docker-desktop` ausentes), seguidos de recuperação automática. Durante esta missão, `wsl --status` confirmou WSL2, `docker-desktop` ficou `Running` e `docker info` passou a responder. Não alterei configurações nem reiniciei o serviço.

O daemon atual tinha zero containers, imagens e volumes antes dos testes, embora documentos antigos registrem um banco local anterior e exista `supabase/backups/backup_pre_h3_15.sql`. Esse backup foi preservado e não restaurado. Para evitar reuso do antigo projeto, foi criada fora do repositório uma cópia temporária com `project_id=mk9-date-m25`, seed desligado e migration tracking ligado apenas nessa cópia. O teste usou o PostgreSQL local no container/volume novos `supabase_db_mk9-date-m25`; nenhuma conexão ou alteração remota foi feita. O banco/container temporário permanece intacto, sem exclusão de volume.

## Sequência SQL

Foram aplicadas na base temporária as 42 migrations SQL do diretório principal, desde a base de 30/09 até `20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql`. Para a cópia de teste, nomes com prefixos repetidos receberam versões únicas e as quatro migrations da base de 30/09 foram ordenadas por dependência (import tables, profiles, status de profiles, reestruturação de rotas). Os arquivos originais não foram renomeados. Todas as 42 versões aparecem no tracking local; a migration alvo foi aplicada por último e compilou no PostgreSQL 17.

O repositório contém prefixos duplicados em 30/09, 06/10, 07/10, 08/10 e `20261020160000`. Além disso, `supabase/config.toml` mantém `[db.migrations] enabled = false` e não há `supabase/seed.sql`, embora seed esteja habilitado no config original. A cópia temporária usou nomes únicos e seed desabilitado; portanto, a validação não prova que o histórico atual do projeto Supabase existente pode ser aplicado pelo CLI sem uma decisão de versionamento. O banco remoto não foi consultado, conforme solicitado.

## Testes de banco

`supabase/tests/visit_regularization.sql` foi executado com `psql -v ON_ERROR_STOP=1` dentro do container local isolado e terminou em `ROLLBACK`. O primeiro ciclo revelou um `ON CONFLICT` de fixture inválido e, depois, falta de permissão da role `authenticated` para ler snapshots temporários; ambos foram corrigidos. A execução final passou, cobrindo:

- encerramento sem comprovação e conclusão com foto/checklist existentes;
- autoria e escopo de supervisor permitido/negado, admin e bloqueio de promotor;
- motivo e comprovação insuficiente;
- status, timestamps, GPS e linhas de evidência preservados;
- auditoria e rejeição de alteração da auditoria;
- visitas antigas não bloqueando o check-in atual, mesma ocorrência idempotente e segunda ocorrência ativa no dia rejeitada.

Concorrência foi verificada em duas conexões PostgreSQL independentes por cenário:

- regularizações simultâneas da mesma visita: uma aceita, a outra recebe `Visit already regularized`; exatamente um evento de auditoria e nenhum `completed_at` fabricado;
- check-ins simultâneos em lojas distintas para a mesma matrícula/data: um aceito, o outro recebe `Another visit is in progress`; uma visita ativa;
- check-ins simultâneos repetidos para a mesma ocorrência: ambos retornam o mesmo ID e permanece uma ocorrência ativa.

## Indicadores do promotor

Após os testes, o container temporário foi parado para liberar a porta 54322. O container e o volume foram mantidos; nenhuma remoção Docker foi executada.

Visitas regularizadas preservam `status='em_andamento'` por desenho, mas não devem bloquear o promotor nem ser exibidas como em andamento. Ajustei `src/utils/promoterPortalPresentation.ts` e `src/views/PromoterPortalView.tsx`: decisões administrativas não entram no bloqueio por visita antiga nem nas contagens de atividade em andamento; a lista de histórico mostra uma etiqueta administrativa própria e mantém as contagens separadas. O RH/Faltas e Atestados não foi alterado. Indicadores globais externos a essas telas não foram redefinidos.

## Validação de aplicação

`npm run typecheck` passou; `npm test` passou com 415 testes e 0 falhas; `npm run build` passou com avisos existentes de `__dirname` e bundle acima de 500 kB; `git diff --check` e a verificação de whitespace dos arquivos novos passaram.

As migrations e testes do banco foram executados em PostgreSQL local limpo, com as versões da cópia temporária. As verificações finais de TypeScript, suíte JavaScript, build e whitespace foram repetidas após os ajustes nesta missão; os resultados estão no relatório final desta missão.

A migration está tecnicamente testada em schema limpo isolado. Antes de aplicação no projeto Supabase existente, ainda é necessária uma revisão de compatibilidade com o schema e histórico realmente implantados. Não executar `db reset` no projeto original; não houve push, commit, deploy nem alteração remota.
