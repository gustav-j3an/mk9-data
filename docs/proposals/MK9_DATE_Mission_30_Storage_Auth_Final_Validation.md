# MK9 Date — Missão 30: validação final de Storage e Auth

## Escopo e preservação

Auditoria direcionada da migration `supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql`. Nenhuma escrita foi feita no Supabase remoto; não foram feitas alterações em policies, buckets ou dados. O repositório permaneceu na branch `recovery/mk9-date-completo`, HEAD e `origin/main` em `54a67bd0d3d9537c2632a8f5b09a664a25eae7ee`. O trabalho local prévio foi preservado.

## Storage

A migration não referencia `storage.objects` ou `storage.buckets`, não cria/altera policies no schema `storage`, e não altera grants de Storage. Ela substitui `attendance_private.photo_upload_allowed(text)` (SECURITY DEFINER, `search_path=''`), função chamada diretamente pelas policies remotas de `storage.objects` para INSERT, UPDATE e DELETE do bucket `visit-photos`. Portanto:

- Não há dependência de DDL de Storage para aplicar a migration.
- Há uma dependência funcional indireta real: as policies já instaladas passam a usar a nova lógica da função.
- A consulta de catálogo remota confirmou as policies `attendance_photo_insert_guard`, `attendance_photo_owner_insert`, `attendance_photo_update_guard`, `attendance_photo_owner_cleanup` e `attendance_photo_delete_guard`; suas expressões chamam `attendance_private.photo_upload_allowed(name)`. A policy `attendance_photo_read_guard` chama `photo_read_allowed`, função que esta migration não altera.
- A migration preserva acesso de staff autorizado e limita promotores a visita ativa, não regularizada e no dia operacional atual. O teste SQL da Missão 29 verificou a função negando upload em visita regularizada e permitindo upload na visita ativa do mesmo promotor.

Nenhuma policy ou bucket precisou ser criado no PostgreSQL de teste para executar a migration. Reproduzir a policy do Storage seria necessário para uma prova de integração completa do gateway de objetos, mas não para validar a dependência SQL da função. Isso fica como risco residual de integração: a homologação não fez upload/download via API Storage.

## Auth e autorização

O contrato Auth usado pela migration é restrito a `auth.uid()` e à referência `auth.users(id)` da auditoria. A migration não usa tabelas internas adicionais do GoTrue, hooks de Auth ou funções internas de login.

Metadados remotos consultados:

- `auth.users.id` é UUID e NOT NULL.
- `auth.uid()` retorna UUID, não é SECURITY DEFINER e não tem configuração especial de search_path. A implementação remota/contrato de claims foi reproduzido na fixture Mission 29.
- As funções remotas `attendance_private.staff_can_access(text)`, `can_read_visit(uuid)`, `photo_upload_allowed(text)` e `photo_read_allowed(text)` são SECURITY DEFINER, `search_path=public, pg_temp`, executáveis por `authenticated`; a migration substitui a função de upload com `search_path=''` e concessão explícita a `authenticated`.

A fixture reproduz somente a chave UUID de `auth.users` (sem linhas reais), `auth.uid()` baseada nos claims JWT, roles locais (`anon`, `authenticated`, `service_role`), perfis sintéticos, escopo de supervisor e políticas necessárias das tabelas públicas. Os testes exercitam administrador, supervisor dentro/fora do escopo e promotor, além de grants/RLS para os cenários cobertos. Não reproduzem GoTrue nem validam emissão/assinatura de tokens ou o PostgREST real; esses componentes não são dependências internas da migration. Assim, o contrato de autorização SQL está suficientemente validado para a decisão desta migration, com a limitação usual de não ser uma homologação ponta a ponta de Auth.

## Classificação das pendências

| Item | Classificação | Evidência/justificativa |
|---|---|---|
| Policies/buckets de Storage como pré-requisito de DDL | Fora do escopo da migration | Nenhum objeto `storage.*` é alterado ou referenciado no SQL de instalação. |
| Função de upload chamada pelas policies remotas | Dependência validada | Policies remotas foram lidas; teste SQL validou permissão para visita corrente e negação após regularização. |
| Execução do fluxo real de upload no Storage API | Risco residual | Não foi feita chamada à API nem escrita remota; teste isolado cobre função/policy SQL relacionada, não o serviço de objetos. |
| `auth.users(id)` e `auth.uid()` | Dependência validada | Metadados remotos compatíveis e fixture reproduz chave e resolução de claim; IDs de teste sintéticos. |
| GoTrue interno, sessão real e assinatura JWT | Fora do escopo da migration / risco de integração | Não há referência a componentes internos; não foi feita autenticação ponta a ponta. |
| Permissões/escopo SQL de administrador, supervisor e promotor | Dependência validada | Reproduzidos e exercitados no conjunto SQL da Missão 29, incluindo supervisor fora do escopo e negação ao promotor. |
| Bloqueio técnico concreto para aplicar a migration | Nenhum identificado nesta auditoria | O erro de leitura de catálogo ocorrido na Missão 29 não se repetiu; a consulta read-only retornou as policies relevantes. |

## Procedimento para submissão à aprovação

1. Submeter para aprovação exatamente o arquivo de migration acima, sem edições ou execução parcial.
2. Antes da janela, confirmar no projeto `xzmbesqhxcnuokjwrbnw` que a assinatura atual de `attendance_private.photo_upload_allowed(text)`, as policies de `visit-photos` e o hash/conteúdo do arquivo revisado continuam iguais; interromper se houver drift.
3. Confirmar backup/PITR operacional, sessão administrativa autorizada e janela com baixa atividade. A migration estabelece transação, `lock_timeout='3s'` e `statement_timeout='60s'`; executar o arquivo inteiro como uma unidade, sem remover o `BEGIN`/`COMMIT` e sem aplicar trechos isolados. Interromper se ocorrer qualquer erro ou timeout e confirmar rollback antes de qualquer nova tentativa.
4. Após commit, conferir existência da coluna `visits.regularization_status`, tabela/índice/audit trigger e políticas públicas criadas, bem como assinatura, definição, SECURITY DEFINER, `search_path=''` e ACL de `photo_upload_allowed` e RPCs de atendimento/regularização.
5. Confirmar por catálogo que as policies existentes do Storage continuam presentes e continuam referenciando as funções esperadas. Fazer smoke test autorizado com usuário de teste controlado: upload em visita ativa autorizada deve funcionar; upload em visita regularizada/fora de escopo deve ser negado. Não usar dados ou visitas reais para regularização de teste.
6. Interromper e acionar recuperação se houver policy ausente, grant inesperado, erro de função, mudança de comportamento em upload/leitura ou divergência de escopo. Como o SQL é transacional, falha antes do commit deve ser revertida pelo próprio PostgreSQL; após commit, recuperação exige correção reversa específica revisada, sem apagar auditoria ou evidências.

## Validações da aplicação

- `npm run typecheck`: aprovado em execução sequencial. Uma execução simultânea inicial com build falhou transitoriamente porque `dist/assets/index-D76xg_ou.js` desapareceu durante a regeneração; repetido isoladamente, aprovou.
- `npm test`: aprovado, 421/421 (73 suites).
- `npm run build`: aprovado; avisos não bloqueantes sobre `__dirname` no Vite e bundle acima de 500 kB.
- `git diff --check`: aprovado.

## Decisão

Não foi identificado bloqueio técnico concreto relacionado a Storage ou Auth para submeter a migration à aprovação de implantação no projeto existente. A aprovação deve carregar o procedimento acima e reconhecer que o smoke test do Storage API é uma verificação posterior, não realizada nesta auditoria. Esta conclusão não afirma que a migration foi aplicada nem que a funcionalidade está ativa em produção.
