# Pré-implantação segura do Controle de Presença

## Decisão: implantação bloqueada

Produção foi consultada exclusivamente por SELECT e leitura de metadados, em 18/10/2026 no horário de São Paulo (19/10 UTC no ensaio). Nenhuma migration, alteração de esquema, dado, permissão, configuração ou deploy foi executada no remoto. Não foram executados DELETE/TRUNCATE nem removidas bases locais.

Este relatório substitui a avaliação anterior de prontidão para implantação. As sete migrations passam no ensaio local, mas a reprodução de uma política real de Storage revelou um bloqueio de segurança. Backup recuperável de produção ainda não foi comprovado.

## Estado observado de produção

Projeto mk9-data ativo/saudável, sa-east-1, PostgreSQL 17.11.0.002. Foram inspecionadas 19 tabelas públicas, todas com RLS habilitada, 54 políticas em public/storage, funções, constraints, índices, triggers, grants e agregados. Não foram exportados dados pessoais, coordenadas, fotografias ou credenciais.

| Objeto | Quantidade |
| --- | ---: |
| Promotores | 44 |
| Lojas | 436 |
| Indústrias | 24 |
| Rotas | 352 |
| Visitas | 12 |
| Registros de fotografias | 3 |
| Metadados de objetos Storage, todos os buckets | 6 |

As verificações retornaram zero: chaves de visita duplicadas; fotos órfãs de visita; fotos sem objeto correspondente por bucket/caminho; visitas sem promotor, loja ou indústria; visitas em andamento/concluídas sem início. Isso verifica referências de metadados, **não os bytes ou checksums das fotos**. Uma equipe está sem supervisor.

Na amostra instantânea não havia locks em espera; isso não garante ausência de bloqueios durante DDL. Perfis agregados: quatro administradores ativos, quatro promotores ativos e um cliente industrial ativo; nenhum gestor observado. operation_mode permanece IMPLANTACAO e official_start_date permanece null; attendance_rules não existe. Não foram alterados esses parâmetros.

## Histórico remoto e diferenças de migrations

O ledger remoto retornou:

| Versão | Nome |
| --- | --- |
| 20260930 | add_status_to_profiles |
| 20261001 | create_visits_tables |
| 20261006 | add_visits_unique_constraint |
| 20261007 | add_delete_user_function |
| 20261008 | auto_generate_store_code |
| 20261015100000 | create_equipes_table |
| 20261016100000 | create_supervisores_table |

Nenhuma das sete migrations de Presença consta nesse histórico. As novas tabelas/RPCs/views não foram encontradas em produção.

Há objetos existentes sem correspondência completa no ledger, versões curtas repetidas nos arquivos legados e duas propostas de unicidade de visitas. Não executar db push, reset ou repair às cegas. Consulte [o inventário](MIGRATIONS_PRESENCA_INVENTARIO.md).

## Ambiente isolado e restauração local

Foi criada uma nova base no Docker existente, sem apontar a aplicação para ela e sem copiar registros operacionais de produção. O frontend/API de homologação anterior permaneceu intacto. O ensaio compartilha o cluster local; não reproduz integralmente o serviço Supabase gerenciado.

Arquivo restaurado: local-before-20261019T000014Z.dump, 438442 bytes. Trata-se de backup **local**, não de produção. Não continha histórico operacional de visitas/promotores/fotos; registros sintéticos explícitos foram inseridos antes das migrations para comparar conteúdo não vazio.

A restauração como postgres falhou na criação de função gerenciada do Realtime por falta de permissão para log_min_messages. A restauração completa em outra base com supabase_admin terminou com código zero. O arquivo omite proprietários e ACL; grants públicos e USAGE de schemas foram reconstruídos no ensaio com base nos catálogos de produção consultados por leitura. Isso não comprova recuperação de todas as configurações do serviço.

Diferenças confirmadas:

- O backup local anterior não tinha equipes/supervisores. Os dois pré-requisitos existentes foram aplicados apenas no ensaio; produção já os tem.
- Local possui industrias.data_inicio_operacao, ausente em produção.
- Produção possui rotas.data e rotas.sequencia, ausentes na origem local. Frequência/dias/UF são NOT NULL em produção e permitem NULL na origem local.
- A diferença inicial de profiles refere-se à ordem física das colunas; os campos comparados não apresentaram diferença semântica.
- As políticas Storage antigas locais são mais restritivas que as reais de produção.
- Local usa dados sintéticos, sem fotos reais. A nova base de ensaio não tem uma pilha independente Auth/Storage/Realtime iniciada.

Portanto, há um ambiente isolado funcional para ensaio SQL, mas **não uma homologação final com paridade de produção**.

## Resultado das sete migrations

Os sete arquivos foram aplicados em ordem, cada um em sua transação, com ON_ERROR_STOP, lock_timeout de 3 segundos e statement_timeout de 60 segundos. São limites do ensaio, a validar para a janela real.

| Ordem | Migration | Resultado |
| --- | --- | --- |
| 1 | 20261018220000_create_promoter_attendance_audit.sql | Aprovada localmente |
| 2 | 20261018230000_create_promoter_schedules_and_absences.sql | Aprovada localmente |
| 3 | 20261018232256_harden_attendance_audit_permissions.sql | Aprovada localmente |
| 4 | 20261018234153_finalize_attendance_journeys_privacy_telemetry.sql | Aprovada localmente |
| 5 | 20261019001109_lock_attendance_telemetry_and_scope.sql | Aprovada localmente |
| 6 | 20261019001848_validate_attendance_schedule_overlaps.sql | Aprovada localmente |
| 7 | 20261019004947_add_attendance_work_location.sql | Aprovada localmente |

A execução final levou entre 0,125 e 0,266 segundo por arquivo, incluindo a chamada ao psql. Isso não estima indisponibilidade em produção.

As 17 tabelas públicas preexistentes da origem tiveram contagens e resumos de conteúdo comparados antes/depois. Os registros anteriores permaneceram iguais, incluindo visita concluída com entrada/saída/coordenadas, foto (metadados), checklist, ocorrência e validade sintéticos. A comparação excluiu somente as cinco colunas novas de visits e separou somente attendance_rules adicionado em settings.

As suítes SQL passaram com admin, gestor/supervisor, operador, promotor, indústria, inativo e anônimo: ajustes auditados, identidade, escopo, jornadas/modelos/feriados, conflitos e telemetria. Para cumprir a proibição de operações destrutivas, as tentativas de DELETE foram substituídas por verificação de ACL/trigger; a limpeza de perfil sintético foi omitida. Fixtures terminaram em ROLLBACK.

Falhas da preparação foram corrigidas antes do ensaio final: usuário de restauração insuficiente, ACL/USAGE omitidos no arquivo e tipo de foto sintética inválido. Não foram modificadas as sete migrations. Bases de tentativas anteriores foram conservadas.

Os 219 testes, TypeScript/build e HTTP da etapa anterior são evidências daquela versão local, não foram repetidos sem necessidade e não certificam o frontend atual sob edição concorrente. Não foram feitos logins ou gravações com identidades reais em produção.

## Bloqueios confirmados

### 1. Isolamento Storage: REPROVADO com a política real

Produção possui a política PERMISSIVE Storage visit-photos select policy para authenticated, cuja condição é apenas bucket_id='visit-photos'. A migration 4 adiciona outra política PERMISSIVE exigindo vínculo com a visita. Políticas permissivas combinam por OR; a anterior continua concedendo acesso amplo.

Reprodução local após as sete migrations: temporariamente usado o predicado real da política, criado apenas metadado de objeto sintético sem vínculo com visita e usada identidade authenticated sem perfil válido. Resultado: unrelated_storage_object_visible=true. A transação foi revertida. Nenhuma foto real foi acessada.

Antes de liberar, corrigir a política legada ou aplicar proteção restritiva compatível com os fluxos existentes. Testar objetos de outra equipe/indústria e perfis inativos/sem vínculo. O INSERT remoto no bucket também é amplo e exige análise do fluxo de upload. Não basta adicionar outra política permissiva.

### 2. Privilégios legados

Foram observadas 34 combinações tabela/papel com TRUNCATE para anon/authenticated. RLS não protege TRUNCATE. Não foi executada essa operação e não se afirma que o REST padrão ofereça tal endpoint. É excesso de privilégio relevante diante de RPC/conexão indevida; as sete migrations não o eliminam no legado.

Preparar revogação mínima revisada, verificar default privileges, proprietários e EXECUTE de funções, preservando permissões necessárias dos módulos.

### 3. Frontend incompatível no estado atual

IndustryPortalView.tsx voltou a consultar visits/promotores diretamente e fotos com embed de visits. A nova RLS bloqueará essas leituras industriais. A release precisa incorporar as views sanitizadas e revisar também os embeds de promotor em rotas. O workspace está sob edição concorrente e não foi congelado como release.

Clientes antigos que gravam started_at/completed_at diretamente serão bloqueados; devem usar attendance_check_in/out. A imutabilidade também impede excluir visita iniciada e alterar identidade/telemetria original. Revisar correções administrativas, importadores e integrações existentes antes da troca.

### 4. Paridade e escopo

Ainda não houve aplicação sobre cópia fiel de todo o catálogo público/Storage de produção. A diferença de políticas explica o falso conforto de testes locais anteriores.

Supervisor é representado por gestor vinculado a supervisores.user_id. Gestor sem esse vínculo permanece global conforme regra implementada, dependente de validação administrativa. Cockpit, dashboard, tracking, cadastros, contratos, rotas, relatórios e importadores precisam de regressão por papel na release final.

### 5. Locks e histórico

ALTER TABLE, validação de constraints e criação de índices podem bloquear operações. Os scripts têm BEGIN/COMMIT próprios e nem todos são idempotentes; falha em uma etapa não desfaz etapas já confirmadas. Verificar objetos/ledger antes de retomar.

O pacote não contém DELETE/TRUNCATE/DROP TABLE de dados, mas altera constraints, políticas e schema de função. Há ON DELETE CASCADE em vínculos de jornadas/ausências; exclusões futuras de cadastros exigem revisão. Auditoria de jornadas cobre INSERT/UPDATE; retenção e remoção física também precisam de validação. Não prometer zero downtime nem preservação diante de qualquer exclusão futura.

## Situação do backup

**Backup recuperável de produção: NÃO COMPROVADO.** Não foi confirmada existência de backup gerenciado, retenção, PITR ou último ponto restaurável; não houve restauração de origem de produção.

O conector não lista backups. A consulta ao painel depende de uma aba acessível no perfil Chrome solicitado pelo usuário. A automação listou dois perfis sem abas e não conseguiu criar janela no perfil alternativo; não foi usada credencial nem trocada conta automaticamente.

Backup local: existência e restauração SQL confirmadas com as limitações de proprietário/ACL descritas. O SQL backup_pre_h3_15.sql existente não foi certificado quanto à origem/recuperabilidade. Nenhum desses arquivos substitui backup de produção.

Para aprovar: verificar no painel/Management API autorizada data/status/retenção/ponto restaurável; restaurar em destino separado; comparar dados/relacionamentos e registrar RPO/RTO medidos. Exigir cópia verificável dos bytes do Storage e teste de fotos autorizadas. Backup de banco contém metadados, não arquivos Storage; configurações externas de Auth, chaves e Realtime precisam de inventário separado. [Backups oficiais](https://supabase.com/docs/guides/platform/backups), [restauração e Storage](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore).

## Plano de implantação — não executado

1. Resolver os bloqueios de Storage, grants e frontend; conciliar catálogo/ledger e congelar commit/hashes. Não sobrescrever alterações concorrentes.
2. Comprovar backup/PITR/Storage e restauração separada. Aprovar RPO/RTO e responsável. Sem isso, NÃO IMPLANTAR.
3. Homologar catálogo equivalente com fixtures sintéticas e os quatro acessos: administrador, supervisor, promotor e indústria. Verificar fotos privadas/upload, check-in/out, contratos/rotas/importação e relatórios, incluindo casos negativos.
4. Rever constraints, integridade, escopos, RPCs/EXECUTE e privilégios; validar desempenho e locks em volume compatível.
5. **Apresentar a versão exata, janela, backup/ponto de recuperação e riscos ao usuário. PARAR até autorização explícita. Este relatório não é autorização.**
6. Após autorização, usar janela coordenada com controle de gravações; impedir clientes incompatíveis de continuar gravando durante a troca.
7. Aplicar somente as migrations revisadas e autorizadas na ordem indicada, registrando ledger/checksum. Adotar timeouts no mesmo contexto de cada transação. Não envolver sete arquivos com COMMIT próprio em BEGIN externo esperando atomicidade global; não aplicar o resto do legado automaticamente.
8. Publicar frontend compatível, atualizar caches e verificar recarga do schema PostgREST. NOTIFY não comprova atualização de todos os clientes.
9. Comparar agregados/integridade com referência consistente da janela; preservar IDs/horários/telemetria e validar acesso privado às fotos. Smoke tests somente com contas/registros autorizados.
10. Reabrir com monitoramento de erros de autorização, conflitos, latência, fotos e auditoria por janela operacional acordada. Vazamento/perda de vínculo/erro de integridade implica suspender reabertura.

## Plano de recuperação — não executado

- Falha dentro da etapa: verificar rollback e ledger; etapas anteriores já confirmadas permanecem. Não repetir arquivo cegamente.
- Falha de contrato frontend/API: manter gravações do fluxo afetado suspensas e corrigir progressivamente. Não reabrir tabelas brutas nem voltar cliente que falsifica horários.
- Incidente de dados: preservar evidências e restaurar backup/PITR primeiro em destino isolado. Comparar delta válido e preparar recuperação aprovada. Restore in-place pode perder gravações posteriores e causar indisponibilidade; não é teste exploratório.
- Incidente de fotos: recuperar bytes do backup Storage, reconciliar caminhos/tamanhos/checksums e testar acesso privado. Metadados sozinhos não recuperam arquivos.
- Qualquer restauração de produção requer autorização explícita própria, com destino, ponto temporal, perdas posteriores e janela. Sem plano ensaiado/ponto recuperável, manter bloqueio.

## Pendências de homologação

- Comprovar backup/PITR/Storage e ensaiar restauração de origem de produção em destino separado.
- Corrigir Storage/grants e testar as políticas reais.
- Corrigir/congelar integração industrial e RPCs; executar CI da release final.
- Homologar catálogo equivalente e fluxos reais de promotor, fotos, GPS e módulos existentes.
- Aprovar jornadas, tolerâncias, fechamento, supervisor pendente, escopo global de gestor e retenção.
- Aprovar janela/RPO/RTO/responsáveis; solicitar autorização explícita antes de qualquer aplicação.

## Evidências e arquivos

Script: scripts/rehearse_attendance_release.py. Evidências em scratch/attendance-homologation/ (ignorado pelo Git): release-rehearsal.json, restore-rehearsal-final.log, rehearsal-tests.log, production-storage-policy-reproduction.log e inventários somente de esquema/grants. O script não lê .env nem acessa produção, cria nova base local e preserva tentativas. Os inventários são entradas locais obtidas por leitura autorizada.

A seguir, hashes dos sete arquivos efetivamente ensaiados:

| Migration | SHA-256 |
| --- | --- |
| 20261018220000_create_promoter_attendance_audit.sql | `cea038c214c24428d9566931dfa854eab2b677e267e71df3051a3b97dc0cfa1a` |
| 20261018230000_create_promoter_schedules_and_absences.sql | `6f18908957b820f6d5c4fbef641397db13a1f9c6583f000bcf33c9699d577abb` |
| 20261018232256_harden_attendance_audit_permissions.sql | `9fc634463a35c2a7d750cfac9b12d79d764511f5504581ceff8e44f1f45a78e3` |
| 20261018234153_finalize_attendance_journeys_privacy_telemetry.sql | `c6766b16bcdad92792f96d7b113e2c61d70179220621698ece0e936c1ff4d9dc` |
| 20261019001109_lock_attendance_telemetry_and_scope.sql | `40a85b674760675be4403957f4426eac3c7d1138ea44a553d180a2723d8ba7e4` |
| 20261019001848_validate_attendance_schedule_overlaps.sql | `0d296bab8fc9c60a030040b617137852cf87fd793b4298ed618876cc62a55753` |
| 20261019004947_add_attendance_work_location.sql | `e51d53e9e17cbb4c8688e549dbb6b97c865257b18109dd28897404c92e92d1a3` |
