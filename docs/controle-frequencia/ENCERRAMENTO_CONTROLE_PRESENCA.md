# Encerramento técnico — Controle de Presença MK9 Date

**Resultado desta auditoria: PARCIALMENTE CONCLUÍDO.**

O núcleo de classificação, filtragem e exportação está implementado e há testes TypeScript aprovados. Não é possível declarar o módulo tecnicamente concluído porque as suítes SQL de integração e segurança não foram aprovadas nesta auditoria, e a compatibilidade com o histórico remoto de migrations não foi confirmada. Não foi aplicada migration em produção nem alterado dado real.

## Escopo e método

Foram inspecionados a interface de presença, engine e serviços administrativos, integração com os portais, migrations, testes SQL, testes TypeScript e relatórios anteriores. Os resultados abaixo separam evidência de código/teste de confirmação operacional. Os relatórios anteriores foram usados como histórico, não como prova independente de estado atual.

Nenhum navegador foi automatizado. Não houve acesso de escrita a produção. O ensaio SQL local foi transacional e revertido; as fixtures e alterações de schema do ensaio não foram mantidas.

## A. Funcionalidades concluídas

Concluídas e validadas no escopo específico dos testes TypeScript executados:

- Classificação de presença, atraso, espera pelo expediente, falta confirmada e ausência de expediente; limites de tolerância e fechamento estão cobertos por [attendanceEngine.test.ts](../../src/utils/attendanceEngine.test.ts).
- Validação de localização GPS com ausência de evidência, coordenadas inválidas, precisão insuficiente e referência/raio disponíveis, coberta pelo mesmo teste.
- Aplicação combinada de filtros e consistência das linhas filtradas/exportadas, cobertas pelo teste de filtros no mesmo arquivo.
- Geração e leitura de arquivo XLSX, preservando dados textuais sem fórmulas, coberta por [attendanceService.test.ts](../../src/lib/attendanceService.test.ts).

Essas aprovações são testes de unidade/contrato. Não comprovam uma jornada completa com persistência no Supabase, usuário real ou RLS de produção.

## B. Matriz de verificação das 28 funcionalidades

| # | Funcionalidade | Classificação | Evidência direta / limite |
|---:|---|---|---|
| 1 | Controle de presença dos promotores | IMPLEMENTADO, MAS NÃO VALIDADO | Interface e carregamento em [AttendanceControlView.tsx](../../src/views/AttendanceControlView.tsx), engine em [attendanceEngine.ts](../../src/utils/attendanceEngine.ts); fluxo integrado Supabase não passou por teste SQL completo. |
| 2 | Classificação de presentes, faltas e atrasos | IMPLEMENTADO E VALIDADO | Casos de estado, tolerância e fechamento em [attendanceEngine.test.ts](../../src/utils/attendanceEngine.test.ts). |
| 3 | Cadastro de jornadas de trabalho | IMPLEMENTADO, MAS NÃO VALIDADO | Formulário/serviço em [AttendanceJourneyPanel.tsx](../../src/components/AttendanceJourneyPanel.tsx) e [attendanceAdministration.ts](../../src/lib/attendanceAdministration.ts); escrita no banco não foi validada pela suíte SQL. |
| 4 | Modelos de jornada reutilizáveis | IMPLEMENTADO, MAS NÃO VALIDADO | Tabela/RPC e teste planejado em [20261019013007_complete_attendance_operational_setup.sql](../../supabase/migrations/20261019013007_complete_attendance_operational_setup.sql) e [attendance_operational_setup.sql](../../supabase/tests/attendance_operational_setup.sql); teste SQL bloqueado. |
| 5 | Associação individual de jornadas | IMPLEMENTADO, MAS NÃO VALIDADO | RPC `apply_attendance_journeys` aceita matrícula individual em [20261019013007_complete_attendance_operational_setup.sql](../../supabase/migrations/20261019013007_complete_attendance_operational_setup.sql); persistência não aprovada em teste SQL. |
| 6 | Associação de jornadas em lote | IMPLEMENTADO, MAS NÃO VALIDADO | UI/serviço aceitam várias matrículas; a suíte [attendance_operational_setup.sql](../../supabase/tests/attendance_operational_setup.sql) cobre atomicidade, mas não concluiu. |
| 7 | Configuração de horários e intervalos | IMPLEMENTADO, MAS NÃO VALIDADO | Campos, validação e RPC em [attendanceAdministration.ts](../../src/lib/attendanceAdministration.ts) e migrations de jornadas; gravação integrada pendente de validação. |
| 8 | Configuração de tolerâncias | IMPLEMENTADO, MAS NÃO VALIDADO | Tolerância individual/global e rejeição de configuração inválida em [attendanceEngine.ts](../../src/utils/attendanceEngine.ts); configuração administrativa no teste SQL não foi aprovada. |
| 9 | Configuração de folgas | IMPLEMENTADO, MAS NÃO VALIDADO | Schema/RLS em [20261018230000_create_promoter_schedules_and_absences.sql](../../supabase/migrations/20261018230000_create_promoter_schedules_and_absences.sql); classificação de folga tem teste de unidade, mas a administração persistida não foi validada. |
| 10 | Configuração de férias e afastamentos | IMPLEMENTADO, MAS NÃO VALIDADO | Tipos e classificação em [attendanceEngine.ts](../../src/utils/attendanceEngine.ts); controle persistido usa ausências e permanece sem teste SQL aprovado. |
| 11 | Calendário de feriados | IMPLEMENTADO, MAS NÃO VALIDADO | Regras por abrangência e precedência local cobertas em [attendanceEngine.test.ts](../../src/utils/attendanceEngine.test.ts); cadastro administrativo no banco não foi validado. |
| 12 | Configuração de fechamento da presença | IMPLEMENTADO, MAS NÃO VALIDADO | RPC de regras/aprovação e estado de prontidão em migrations finais; fluxo SQL de aprovação não concluiu. A falta automática não é aprovada implicitamente pelo frontend. |
| 13 | Integração com check-in e check-out | IMPLEMENTADO, MAS NÃO VALIDADO | RPCs `attendance_check_in`/`attendance_check_out` em [20261018234153_finalize_attendance_journeys_privacy_telemetry.sql](../../supabase/migrations/20261018234153_finalize_attendance_journeys_privacy_telemetry.sql); teste de idempotência disponível, mas não aprovado. |
| 14 | Preservação da telemetria original | IMPLEMENTADO, MAS NÃO VALIDADO | Engine mantém o check-in original sob ajustes; migrations protegem telemetria e o teste SQL cobre imutabilidade. A asserção no banco não foi executada até o fim. |
| 15 | Validação de GPS quando há evidências suficientes | IMPLEMENTADO E VALIDADO | Casos de coordenadas, precisão e referência de loja cobertos em [attendanceEngine.test.ts](../../src/utils/attendanceEngine.test.ts). A validação não presume dados de GPS ausentes. |
| 16 | Controle de atestados | IMPLEMENTADO, MAS NÃO VALIDADO | Estados pendente/aprovado e efeitos de classificação existem no engine; gravação, autorização e trilha SQL não foram validadas integralmente. |
| 17 | Ajustes manuais com justificativa | IMPLEMENTADO, MAS NÃO VALIDADO | UI e validações em [AttendanceControlView.tsx](../../src/views/AttendanceControlView.tsx) e [attendanceService.ts](../../src/lib/attendanceService.ts); autorização/persistência por perfil dependem da suíte SQL bloqueada. |
| 18 | Auditoria das alterações | IMPLEMENTADO, MAS NÃO VALIDADO | Tabelas/RPCs auditáveis nas migrations de presença; [attendance_permissions.sql](../../supabase/tests/attendance_permissions.sql) contém asserções de trilha não aprovadas nesta execução. |
| 19 | Vínculos entre supervisores e promotores | IMPLEMENTADO, MAS NÃO VALIDADO | Vínculo por equipe, resolução sem atribuição arbitrária e restrições em migrations e [attendanceEngine.test.ts](../../src/utils/attendanceEngine.test.ts); isolamento RLS permanece sem validação SQL concluída. |
| 20 | Atribuição administrativa de supervisores | IMPLEMENTADO, MAS NÃO VALIDADO | Painel explícito com confirmação e justificativa em [AttendanceSupervisorPanel.tsx](../../src/components/AttendanceSupervisorPanel.tsx); RPC e auditoria em migration final, sem teste SQL aprovado. |
| 21 | Indicadores do dashboard | IMPLEMENTADO, MAS NÃO VALIDADO | Indicadores derivam da população elegível na interface [AttendanceControlView.tsx](../../src/views/AttendanceControlView.tsx); não foi concluído teste integrado com dados/configuração operacional reais. |
| 22 | Filtros combinados | IMPLEMENTADO E VALIDADO | Busca, supervisor, equipe, estado e inclusão de fora da escala em [attendanceEngine.test.ts](../../src/utils/attendanceEngine.test.ts). |
| 23 | Exportação Excel | IMPLEMENTADO E VALIDADO | Escrita/leitura XLSX, texto não executável como fórmula e preservação dos dados cobertos em [attendanceService.test.ts](../../src/lib/attendanceService.test.ts). |
| 24 | Permissões por perfil | IMPLEMENTADO, MAS NÃO VALIDADO | Guards de UI, RPCs e cenários admin/gestor/operador/promotor/indústria/anônimo em migrations e [attendance_permissions.sql](../../supabase/tests/attendance_permissions.sql); SQL não aprovado. |
| 25 | Políticas RLS | IMPLEMENTADO, MAS NÃO VALIDADO | Policies restritivas e escopos em migrations; não há aprovação das suítes de permissão nesta auditoria. |
| 26 | Segurança das fotografias | IMPLEMENTADO, MAS NÃO VALIDADO | Guards restritivos de Storage/metadados e proteção de referência em [20261019011832_secure_attendance_photos_and_release_contract.sql](../../supabase/migrations/20261019011832_secure_attendance_photos_and_release_contract.sql); [attendance_photo_security.sql](../../supabase/tests/attendance_photo_security.sql) não concluiu. |
| 27 | Compatibilidade com o Portal da Indústria | IMPLEMENTADO, MAS NÃO VALIDADO | Consultas migradas para views sanitizadas em [IndustryPortalView.tsx](../../src/views/IndustryPortalView.tsx), com teste de contrato em [canonicalSchemaRegression.test.ts](../../src/utils/canonicalSchemaRegression.test.ts); acesso real sob RLS não foi validado em SQL. |
| 28 | Responsividade da interface | IMPLEMENTADO, MAS NÃO VALIDADO | Layout responsivo por classes adaptativas em [AttendanceControlView.tsx](../../src/views/AttendanceControlView.tsx); sem validação visual/browser, conforme restrição de não usar automação de navegador. |

**Contagem da matriz:** 28 funcionalidades verificadas; 4 implementadas e validadas no escopo de unidade; 24 implementadas, mas sem validação integrada completa; nenhuma foi comprovadamente inexistente. “Não validado” não significa que a funcionalidade falhou ou que está ausente.

## C. Problemas corrigidos nesta auditoria

- O Portal da Indústria consultava tabelas operacionais diretamente apesar de existirem views com escopo e projeção sanitizados. As consultas centrais de visitas, rotas, promotores e evidências/fotos passaram a usar `industry_visits`, `industry_routes`, `industry_promoters` e `industry_visit_photos` em [IndustryPortalView.tsx](../../src/views/IndustryPortalView.tsx).
- Foi adicionado/ajustado o teste de regressão do contrato de views em [canonicalSchemaRegression.test.ts](../../src/utils/canonicalSchemaRegression.test.ts).
- O teste de segurança de fotos limpa o claim de identidade herdado antes das fixtures em [attendance_photo_security.sql](../../supabase/tests/attendance_photo_security.sql).

Não foram atribuídos supervisores nem criadas jornadas reais.

## D. Testes

| Verificação | Executado | Resultado |
|---|---:|---|
| Testes automatizados TypeScript (27 arquivos, 59 suites) | 250 testes | **250 passaram, 0 falharam** |
| `npm run lint` (`tsc --noEmit`) | Sim | **Passou** |
| `npm run build` | Sim | **Passou**; Vite emitiu aviso de chunk JS acima de 500 kB e aviso de compatibilidade futura de configuração. |
| Suítes SQL locais disponíveis | 4 suítes | **0 aprovadas; 4 não concluídas**. O runner parou na preparação de fixtures relacionais de indústria/visita; o problema de visibilidade/FK no ambiente local não foi isolado o suficiente para certificar as asserções. |
| Integração SQL de segurança/perfis/fotos | Tentada como parte do runner | **Não aprovada nem declarada como executada com sucesso**; as asserções dependentes do runner não foram certificadas. |

Os testes SQL são `attendance_permissions.sql`, `attendance_finalization.sql`, `attendance_photo_security.sql` e `attendance_operational_setup.sql`. Nenhuma migration ou fixture do ensaio foi deixada persistida. Não foi desativada RLS para contornar a falha.

## E. Segurança

- **RLS e perfis:** migrations definem escopo por perfil/equipe/indústria e restrições de escrita. A existência das policies foi inspecionada; seu comportamento completo não foi comprovado nesta execução porque as suítes SQL não concluíram.
- **RPCs e privilégios:** as migrations revogam execução de funções de `PUBLIC`/`anon` e concedem acesso a `authenticated` onde aplicável; funções privadas são isoladas no schema `attendance_private`. Não foi validado o estado efetivo remoto nem o conjunto completo de grants após replay.
- **Fotografias:** a migration mais recente adiciona guards RLS `RESTRICTIVE` para Storage e metadados, proteção contra referências cruzadas e uma projeção industrial de evidências. Isso foi inspecionado estaticamente; a suíte própria não passou. A ausência de vulnerabilidade efetiva em produção **não está certificada**.
- **Portal da Indústria:** o código corrigido usa views de segurança em vez de expor diretamente os campos operacionais brutos; sua autorização real por RLS ainda depende da validação SQL/staging.
- **Vulnerabilidades críticas:** nenhuma vulnerabilidade crítica foi comprovada por esta auditoria. Isso **não é uma certificação de ausência**, dado que os testes de RLS, Storage e o estado remoto não foram validados.

## F. Banco de dados e migrations

Há nove migrations de presença no diretório raiz, ordenadas por timestamp no código:

1. `20261018220000_create_promoter_attendance_audit.sql`
2. `20261018230000_create_promoter_schedules_and_absences.sql`
3. `20261018232256_harden_attendance_audit_permissions.sql`
4. `20261018234153_finalize_attendance_journeys_privacy_telemetry.sql`
5. `20261019001109_lock_attendance_telemetry_and_scope.sql`
6. `20261019001848_validate_attendance_schedule_overlaps.sql`
7. `20261019004947_add_attendance_work_location.sql`
8. `20261019011832_secure_attendance_photos_and_release_contract.sql`
9. `20261019013007_complete_attendance_operational_setup.sql`

As duas últimas ampliam o inventário anterior de sete migrations. A sequência e as dependências mais recentes foram inspecionadas no código; o replay integral da história legada em base vazia e a compatibilidade com o ledger remoto **não** foram comprovados. Os relatórios prévios registram versões curtas repetidas no legado, migrations antigas com histórico remoto insuficiente e duas migrations relacionadas à unicidade de visitas que requerem reconciliação.

As migrations finais foram usadas somente em ensaio local transacional; não foram mantidas. **Produção não foi consultada nesta etapa para confirmar ledger, objetos, constraints, índices, views, RPCs, triggers, permissões ou backup/PITR.** Portanto:

- Existem nove migrations no código que precisam ser reconciliadas com o estado remoto antes da implantação.
- Não é possível afirmar que todas são “pendentes” no remoto sem verificar o ledger e os objetos existentes.
- Não é possível afirmar compatibilidade integral com produção.
- Nenhuma migration foi aplicada em produção.

## G. Pendências administrativas da MK9

Dependem de dados/decisões explícitos da administração, sem serem defeitos de implementação comprovados:

- Cadastrar jornadas reais e associá-las aos promotores; não inventar jornadas ou preencher automaticamente os promotores atualmente sem jornada.
- Definir intervalos, modalidade, fuso, tolerâncias individuais/globais e localização de trabalho quando aplicável.
- Revisar e atribuir equipes/supervisores reais aos promotores sem vínculo; esta auditoria não atribuiu ninguém.
- Cadastrar feriados e exceções locais, folgas, férias, afastamentos e atestados reais, com aprovações apropriadas.
- Definir início oficial da operação, horário/regra de fechamento e aprovar explicitamente a automação de faltas. Sem configuração/aprovação, falta automática permanece bloqueada por desenho.
- Validar autorizações de operação e dados de check-in/check-out.

A falta de dados reais pode produzir uma tabela vazia ou indicadores zerados. Isso precisa ser distinguido de falha de consulta; a interface deve explicitar erros, e não há evidência aqui de que os registros operacionais devam ser fabricados.

## H. Pendências de implantação

1. Corrigir/isolar a causa da falha do runner SQL local e aprovar as quatro suítes sem desativar RLS nem eliminar as verificações de segurança.
2. Reconciliar as nove migrations com o schema e ledger reais, incluindo conflitos/duplicidades do legado; não executar `db push` ou `repair` às cegas.
3. Executar replay e testes de integração em staging com paridade suficiente de Auth, Storage, grants e políticas de produção.
4. Validar acesso de supervisor e cliente industrial, isolamento de evidências/fotos, upload, leitura e referências cruzadas sob RLS.
5. Confirmar backup recuperável e ensaio de restauração, janela/ordem de implantação e plano de recuperação.
6. Inserir, após aprovação da MK9, configurações e vínculos administrativos reais; conferir a elegibilidade e os indicadores resultantes.
7. Implantar frontend e migrations de forma coordenada, pois as restrições de telemetria e as views alteram contratos em relação a clientes antigos.

## I. Conclusão

**Classificação: PARCIALMENTE CONCLUÍDO.**

O código e as migrations contêm as ferramentas administrativas e operacionais requeridas, e os testes TypeScript, a verificação de tipos e o build passaram. Entretanto, a condição solicitada para encerramento técnico — integração e testes locais aprovados, incluindo SQL/RLS/fotos — não foi demonstrada. O bloqueio específico é a falha de preparação das fixtures relacionais no runner SQL local, somada à ausência de confirmação do estado/ledger remoto. Não se conclui que funcionalidades estejam ausentes, mas não há evidência suficiente para recomendar encerramento técnico sem ressalvas.

Recomenda-se manter o módulo aberto apenas para fechar a validação SQL e a reconciliação de staging. Configurações de jornada, supervisão, calendário e fechamento ficam como homologação/implantação administrativa da MK9, não como justificativa para inventar dados.
