# MK9 Date — Missão 27: estado operacional de visitas e preflight

**Data:** 22 de outubro de 2026  
**Escopo:** corrigir a apresentação de visitas administrativamente regularizadas, validar a data operacional em jornadas noturnas e preparar a implantação sem alterar o Supabase remoto.

## Git e preservação

- Branch `recovery/mk9-date-completo`; `HEAD` e `origin/main` em `54a67bd0d3d9537c2632a8f5b09a664a25eae7ee`.
- O workspace já continha modificações e arquivos não rastreados de missões anteriores. Foram preservados.
- Não houve branch/worktree, reset, merge, commit, push, deploy ou escrita remota.

## Alterações desta missão

- `src/utils/visitCheckInConflict.ts` usa a `data_visita` operacional e a escala capturada (timezone, hora de início/fim) para decidir se uma visita pertence ao dia atual. Jornada noturna atribui o período depois da meia-noite ao dia operacional anterior; timezone ausente/inválido usa `America/Sao_Paulo`.
- Visitas com `regularization_status` deixam de contar como abertas, retomáveis ou bloqueadoras de check-in no Portal. O portal carrega a escala associada nos pontos de consulta relevantes.
- As contagens do Portal separam encerradas sem comprovação e concluídas administrativamente das visitas operacionais em andamento/concluídas. O acompanhamento de visitas apresenta essas resoluções em categorias distintas, sem fabricar conclusão operacional nem reescrever datas ou evidências.
- `src/types.ts` descreve a escala capturada. `src/utils/visitCheckInConflict.test.ts` cobre regularização, estados concluídos, jornada noturna, timezone alternativo e fallback.

Nenhum SQL/migration foi modificado. RH e Faltas e Atestados não foram alterados nesta missão.

## Verificação automatizada e banco local

- `npm run typecheck`: aprovado.
- `npm test`: 421 aprovados, 0 falhas.
- `npm run build`: aprovado. Avisos do Vite sobre `__dirname` e bundle acima de 500 kB.
- `git diff --check`: aprovado.
- Reexecutado `supabase/tests/visit_regularization.sql` no container isolado retido da Missão 25; cenários passaram e terminaram em `ROLLBACK`. O container foi parado ao final, sem apagar seu volume.
- Testes concorrentes não foram repetidos nesta missão. O relatório da Missão 25 registra execução em duas sessões PostgreSQL independentes e aprovação. A repetição atual não constitui homologação do schema remoto.

## Supabase remoto — somente leitura

- Projeto `mk9-data`, ref `xzmbesqhxcnuokjwrbnw`, região `sa-east-1` (identificação e auditoria mais ampla registradas no relatório da Missão 26).
- Ledger consultado novamente: 16 versões, terminando em `20261019013007`. A versão alvo `20261022152449` não está aplicada.
- Consulta ao catálogo confirmou `public.attendance_check_in` existente, `SECURITY DEFINER`, com `search_path=public, pg_temp`; não retornou `attendance_regularize_visit`. O check-in remoto ainda é a versão anterior à alteração que limita o bloqueio à mesma data operacional.
- A Missão 26 confirmou ausência remota da coluna `regularization_status`, da tabela de auditoria e das funções de regularização, junto à presença das dependências estruturais necessárias. A divergência e colisões no ledger local/remoto continuam sendo risco: não usar `db push`, `migration up`, `db reset` ou `migration repair`.
- `supabase/config.toml` mantém `[db.migrations] enabled = false`, coerente com o histórico legado e com o procedimento assistido por SQL Editor descrito na Missão 26. A configuração não foi alterada.
- Nenhum registro operacional ou pessoal foi consultado. Nenhuma escrita remota ocorreu.

## Migration e procedimento de implantação preparado

Arquivo: `supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql`  
SHA-256: `02ED53B872D22DB731E2269F5B0673A810B566A8FDB0640400A4CF7E60F4311C`.

O procedimento permanece o definido no relatório da Missão 26: staging que represente o schema real; backup completo e captura das definições de RPCs/roles; nova conferência de objetos e ledger; executar o arquivo integral via SQL Editor em janela aprovada; confirmar commit e catálogo; somente então registrar `20261022152449` em `supabase_migrations.schema_migrations`; validar ACL, `SECURITY DEFINER`, `search_path`, RLS, trigger, políticas, check-in, autorização e evidências. Em falha ou divergência, parar e investigar. Não habilitar a flag do frontend até homologação independente. O gate `VISIT_REGULARIZATION_BACKEND_VERIFIED` segue `false`.

O SQL não foi aplicado. O banco local da Missão 25 já contém a cadeia de migrations e não reproduz o estado remoto divergente; os testes locais confirmam regressões nessa cópia, não equivalência ao remoto.

## Decisão

As correções locais de classificação/data operacional estão testadas e o frontend continua bloqueando a regularização enquanto a RPC não estiver validada. A migration pode seguir para revisão técnica/administrativa, mas não está pronta para ativação em produção: faltam reconciliação aprovada do ledger e homologação em staging que reproduza o estado remoto. Não declarar produção validada nem liberar o gate.
