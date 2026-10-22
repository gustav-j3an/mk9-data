# MK9 Date — Missão 31: preflight de implantação controlada

## Decisão

**A migration não foi aplicada.** A autorização da Missão 31 condiciona a escrita a backup/PITR atual com ponto de recuperação e capacidade de restauração comprovada. Os meios Supabase disponíveis nesta sessão permitem consultar projeto, migrations e SQL de catálogo, mas não expõem inventário de backups/PITR nem oferecem ensaio de restauração. Não há evidência recente suficiente para satisfazer essa condição. O histórico de backup validado no repositório é datado de 19/10/2026 e é anterior ao estado de produção observado nesta missão; não comprova um ponto recuperável atual. A próxima ação é obter, pelo canal administrativo Supabase, evidência de backup atual e restauração em destino separado. Até isso, não executar SQL de escrita.

## Repositório e integridade do arquivo

- Diretório: `C:\projetos\mk9-data`.
- Branch: `recovery/mk9-date-completo`.
- HEAD e `origin/main`: `54a67bd0d3d9537c2632a8f5b09a664a25eae7ee`.
- Alterações locais preexistentes preservadas.
- SHA-256 da migration: `02ED53B872D22DB731E2269F5B0673A810B566A8FDB0640400A4CF7E60F4311C`.
- O relatório da Missão 30 não registrou o hash, mas os relatórios das Missões 26, 28 e 29 registram o mesmo SHA-256. O arquivo atual coincide com esse hash anterior.
- A migration tem `BEGIN`/`COMMIT`, `lock_timeout='3s'`, `statement_timeout='60s'`; não contém comandos de exclusão, `TRUNCATE`, `DROP` ou `CASCADE`. Os `INSERT`/`UPDATE` que aparecem estão dentro dos corpos das RPCs e triggers criados; não são executados como alteração de linhas durante o DDL. Não há alteração de fotos ou checklists existentes no script de instalação.

## Projeto remoto e preflight somente leitura

- O projeto retornado pela ferramenta é `mk9-data`, ref `xzmbesqhxcnuokjwrbnw`, região `sa-east-1`, estado `ACTIVE_HEALTHY`, PostgreSQL 17.11.0.002.
- O ledger remoto consultado ainda lista 16 versões; não inclui `20261022152449`.
- A consulta de catálogo encontrou `public.attendance_check_in(text,text,uuid,numeric,numeric,numeric)` e `attendance_private.photo_upload_allowed(text)`. Não encontrou a coluna `visits.regularization_status`, a tabela `visit_regularization_audit`, nem as RPCs/funções de regularização. Isso é compatível com migration ainda pendente.
- A consulta anterior da Missão 30 confirmou as policies existentes de `visit-photos`; entre elas, as policies de inserção/atualização/remoção chamam `attendance_private.photo_upload_allowed(name)`. A migration altera essa função, mas não altera as policies nem buckets.
- A migration ainda não foi executada, então não há verificação pós-implantação de RPCs, grants ou RLS.

## Backup e recuperação

Não foi possível confirmar nesta sessão:

1. Um backup/PITR atual do projeto, seu timestamp e retenção.
2. Um ponto específico utilizável para recuperação.
3. Uma restauração recente desse ponto em ambiente separado.
4. Recuperabilidade dos objetos binários do Storage junto dos metadados.

Os documentos locais antigos descrevem uma restauração de backup em ambiente isolado, mas não demonstram que o ponto continua atual nem cobrem o estado posterior observado agora. O documento de preparação de backup também exige evidência corrente e ensaio de restauração. Portanto, o gate de segurança não está satisfeito.

## Testes sequenciais

- `npm run typecheck`: aprovado.
- `npm test`: aprovado, 421/421 (73 suites).
- `npm run build`: aprovado; avisos não bloqueantes do Vite sobre `__dirname` e tamanho do bundle.
- `git diff --check`: aprovado.

## Próximo passo seguro

Solicitar ao responsável pelo projeto evidência administrativa de backup/PITR recente e um restore ensaiado em destino separado, incluindo recuperação dos objetos `visit-photos` ou confirmação explícita de que não são afetados e têm mecanismo de recuperação próprio. Depois de anexada essa evidência, repetir o preflight de drift imediatamente antes da janela. A migration deve então ser executada integralmente, sem alterações, em uma transação e somente após confirmação de todos os gates. Não usar `db push`, `migration up`, `db reset` ou `migration repair`.

## Resultado

Nenhuma escrita remota foi feita; não houve regularização real, mudança de gate do frontend, deploy, commit, push, merge, reset ou alteração local do código da migration. A implantação permanece bloqueada exclusivamente pela falta de prova atual de recuperação confiável; ela não deve ser declarada concluída.
