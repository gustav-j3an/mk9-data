# Diagnóstico de vínculos e plano para aprovação

Data: 19/10/2026. Branch: `feat/mk9-faltas-integration`.

Escopo: inspeção do código e SELECTs no banco do MK9 Date (`mk9-data`), incluindo correspondências cadastrais com contas Auth. Não foram consultados segredos de autenticação, documentos médicos ou o banco do MK9 Faltas. Nenhum código funcional, cadastro, matrícula, perfil ou esquema foi alterado. Não houve migration, navegador, testes repetidos, merge ou deploy. Este arquivo é apenas o relatório solicitado.

A chave anterior não foi utilizada. Sua revogação no MK9 não pode ser confirmada por estas consultas ao Date; o responsável deve confirmar a revogação e fornecer uma nova credencial exclusivamente no ambiente seguro de homologação.

## A. Vínculos comprovados

### Modelo existente e cardinalidade

- `profiles.id` identifica a conta Auth; `profiles.promotor_matricula` identifica o promotor.
- `promotores.equipe` é um único campo TEXT, sem relação N:N de membros. O modelo atual representa **no máximo uma equipe operacional por promotor**, não várias equipes simultâneas.
- `equipes.supervisor_id` referencia um supervisor; um supervisor pode responder por várias equipes. `supervisor_nome` é um campo textual legado.
- Não existe relação persistida entre equipes/indústrias/rotas e os oito UUIDs externos no esquema consultado.
- O JSON da integração já permite vários projetos por equipe e várias equipes por projeto, pois cada UUID de projeto recebe uma lista de códigos EQP. Essa capacidade de configuração não comprova alocações reais.
- Rotas se relacionam diretamente com matrícula, loja e indústria. Nenhuma coluna de equipe/projeto externo é necessária para essas chaves.
- Indústria é o cliente atendido numa rota; não há evidência de que indústria seja equivalente a projeto externo.

### Equipes reais

| Equipe | Código | UUID interno | Supervisor comprovado | Promotores compatíveis |
| --- | --- | --- | --- | --- |
| DF, GO, BA | EQP-001 | 189915d1-96a1-42d6-bf1e-55ad2e4919d9 | PAULO GUSTAVO / SUP-001, por supervisor_id | 0 |
| GO, MT, MS, TO | EQP-002 | 3df376f6-fa09-4ad2-a421-cca27da901d5 | Nenhum UUID vinculado; texto legado “LUCAS” | 0 |

O vínculo EQP-001 → SUP-001 é comprovado; não permite concluir que qualquer promotor específico ou projeto externo pertença à equipe.

### Uso nos módulos e risco de regressão

| Módulo | Uso atual | Consequência para uma futura correção |
| --- | --- | --- |
| Gestão de Equipes | Lista membros pelo nome exato; métricas normalizam o nome. Transferência grava `equipes.nome` em `promotores.equipe` | Gravar somente EQP-001/EQP-002 nos promotores pode funcionar na integração e não aparecer corretamente na tela/métricas existentes |
| Rotas | Referencia matrícula/loja/indústria; mostra equipe e supervisor por join com promotores | Trocar equipe não reassocia diretamente os registros de rota, mas muda apresentação, agrupamentos e acesso |
| Controle de Presença | Resolve equipe ativa por nome ou código; prioriza supervisor_id e admite fallback textual | Corrigir equipe/supervisor altera o responsável exibido e agrupamentos; texto exibido não comprova autorização |
| Permissões do banco | `attendance_private.staff_can_access` consulta usuário → supervisor → equipe → matrícula | Vincular login ou mover promotor pode mudar o acesso a rotas, visitas, fotos e presença |
| Integração MK9 | Exige perfil ativo, papel correto, equipe resolvida e projeto explicitamente mapeado | Mapeamento sozinho não corrige os 44 membros sem equipe resolvida |

A função **implantada** `staff_can_access` dá escopo geral a admin/operador e ao gestor **sem** cadastro de supervisor vinculado; quando o gestor possui supervisor vinculado, exige a equipe correspondente. A integração MK9 é mais restritiva e rejeita gestor sem esse vínculo. Logo, criar/vincular uma conta gestor exige análise do acesso do aplicativo inteiro, não somente do novo módulo.

### Situação operacional real

- 44 promotores ativos; todos com `supervisor` textual nulo.
- 9 possuem equipe textual BRASÍLIA; 35 estão sem equipe. BRASÍLIA não é o nome/código de nenhuma das duas equipes atuais.
- 30 possuem rotas; 14 não possuem rotas.
- 353 registros de rota, 202 lojas distintas e 20 indústrias distintas.
- Nenhuma rota está órfã de promotor pela matrícula.
- 12 registros de visita. Estes números não comprovam conclusão dos atendimentos.
- A tabela `contratos_lojas` está vazia; isso não significa ausência de acordos comerciais fora dessa tabela.

## B. Vínculos prováveis que precisam de confirmação

### Supervisores e contas candidatas

| Supervisor | Identificação | Conta candidata existente | Evidência | O que falta |
| --- | --- | --- | --- | --- |
| PAULO GUSTAVO | SUP-001 / 347a786f-f8c3-4c6a-91dd-7836756781f5 | 28d80ead-7ece-4440-80a0-0b724a873a5a, perfil promotor | Nome exato no perfil e no Auth; email do supervisor não fornece confirmação | Confirmar titularidade e se a pessoa deve atuar como supervisor, promotor ou ambos |
| LUCAS MATHEUS | SUP-002 / 7e0baded-db5f-4957-8d83-39bebb2903a0 | Nenhuma coincidência exata encontrada por nome/email nas contas consultadas | Regional compatível textualmente com o nome de EQP-002, cujo responsável textual é apenas LUCAS | Confirmar se é o mesmo Lucas e identificar a conta; não criar nem vincular automaticamente |
| Gustavo Jean | SUP-003 / 996736cd-aab7-40da-8366-f48d2de2efc7 | d6c3bc2c-3286-4dd3-ade3-e98fd008919e, perfil admin | Email cadastrado no supervisor coincide exatamente com o email da conta Auth, confirmado | Confirmar titularidade; preservar papel admin e decidir necessidade de visão de supervisor |
| Gustavo Jean | mesmo SUP-003 | b6c656fe-8f1a-42cb-9dc0-b3afaf0250e7, perfil promotor | Nome exato, mas email diferente do supervisor; conta já aponta para PRM-7524 | Confirmar finalidade da conta; não substituir pelo admin por semelhança de nome |

Todos os três `supervisores.user_id` continuam nulos. Uma conta candidata por email/nome não é vínculo de autorização comprovado. Nome ou metadados editáveis do Auth não devem ser usados para conceder acesso automaticamente.

Não há perfil gestor no inventário. O papel atual é único por conta. Alterar promotor/admin para gestor pode retirar funcionalidades existentes; não recomendo fazer isso automaticamente. Confirmar primeiro se haverá conta própria de supervisor ou se será necessário, em proposta separada, suportar capacidades combinadas.

### Projetos externos × equipes internas

| Projeto externo | UUID do projeto | Equipe interna | Código EQP | Supervisor | Promotores relacionados | Evidência do vínculo | Pendências |
| --- | --- | --- | --- | --- | --- | --- | --- |
| COMPARTILHADO 61 | 950edb7d-b94f-4555-9e5a-16fb5aa857a3 | Não comprovada | — | — | Não comprovados | UUID fornecido pelo responsável; sem relação local | Lista oficial de alocação por matrícula/equipe/projeto |
| COMPARTILHADO 62 | 600da4d2-4aab-47d6-a81c-3e7a38d717ed | Não comprovada | — | — | Não comprovados | UUID fornecido pelo responsável; sem relação local | Lista oficial de alocação por matrícula/equipe/projeto |
| COMPARTILHADO 63 | 1186bb9a-b1b4-4d2b-a8af-4b34646a3a72 | Não comprovada | — | — | Não comprovados | UUID fornecido pelo responsável; sem relação local | Lista oficial de alocação por matrícula/equipe/projeto |
| COMPARTILHADO BA | b6f69345-c38e-47be-be0f-f17827fe20bf | Não comprovada | — | — | Não comprovados | UUID fornecido pelo responsável; sem relação local | Lista oficial de alocação por matrícula/equipe/projeto |
| COMPARTILHADO GO | 65f7e80f-f615-4ceb-9b8d-80db170735dc | Não comprovada | — | — | Não comprovados | UUID fornecido pelo responsável; sem relação local | Lista oficial de alocação por matrícula/equipe/projeto |
| COMPARTILHADO MS | 5d1a46e3-012c-4ab3-a575-834f5ad6a954 | Não comprovada | — | — | Não comprovados | UUID fornecido pelo responsável; sem relação local | Lista oficial de alocação por matrícula/equipe/projeto |
| COMPARTILHADO MT | 89bccfec-5f8e-4925-8702-6af0d984d5bf | Não comprovada | — | — | Não comprovados | UUID fornecido pelo responsável; sem relação local | Lista oficial de alocação por matrícula/equipe/projeto |
| COMPARTILHADO TO | 46af0780-7b27-4541-92a4-35777992eb6b | Não comprovada | — | — | Não comprovados | UUID fornecido pelo responsável; sem relação local | Lista oficial de alocação por matrícula/equipe/projeto |

Os oito UUIDs são os fornecidos no pedido, ainda sem validação pela API real. Os nomes sugerem uma segmentação diferente das duas equipes amplas, mas não provam critérios geográficos, regionais, comerciais ou de supervisão. Não inferir que 61/62/63 sejam equivalentes a UFs ou equipes. GO aparece nos dois nomes de equipe.

**Nenhum mapeamento projeto → equipe pode ser aprovado com a evidência disponível.**

## C. Cadastros que precisam de correção ou decisão

### Os dois casos de matrícula

| Perfil | UUID da conta/perfil | Valor original | Resultado da análise | Próxima decisão |
| --- | --- | --- | --- | --- |
| PAULO GUSTAVO | 28d80ead-7ece-4440-80a0-0b724a873a5a | NULL | Conta Auth existe; há promotor homônimo PRM-8937 e supervisor SUP-001 | Confirmar identidade e papel antes de qualquer vínculo; não preencher matrícula por nome |
| PROMOTOR TESTE | f0c3eb38-9daa-4e38-bef7-7bdbd85faf54 | NULL | Conta Auth existe, sem promotor correspondente por nome/email | Confirmar se é conta de teste e qual seu destino; não inventar promotor/matrícula nem desativar sem aprovação |

São **matrículas ausentes nos perfis**, não duas matrículas preenchidas que se demonstraram erradas. Não alterar as matrículas originais dos promotores.

As matrículas locais usam códigos como PRM-001, PRM-001-2 e PRM-SEM. A tela de novo promotor inclusive sugere um código PRM com número aleatório. Portanto, não é seguro pressupor que sejam a matrícula de RH usada no MK9. A correspondência externa ainda precisa ser comprovada. PRM-001 e PRM-001-2 identificam pessoas diferentes no inventário; nunca retirar prefixos/sufixos para tentar casar automaticamente.

### Fila de decisões cadastrais

1. Identificar a equipe operacional real de cada um dos 44 promotores. A ausência de equipe válida não invalida suas rotas já cadastradas.
2. Confirmar se BRASÍLIA é nome antigo, grupo independente ou erro cadastral. Não renomear equipe nem reassociar os nove registros por inferência.
3. Confirmar responsável e identidade de login dos três supervisores.
4. Confirmar se “LUCAS” na EQP-002 é SUP-002, antes de preencher supervisor_id.
5. Definir a lista de matrículas por projeto externo, inclusive compartilhamento e transferências.
6. Resolver a finalidade dos dois perfis sem matrícula, sem alterar valores originais nesta etapa.

## D. Alterações técnicas realmente necessárias

### Recomendação principal

**Preservar as equipes operacionais e tratar projeto externo como uma dimensão independente.** Não criar oito equipes estaduais apenas para reproduzir os oito projetos externos.

A relação projeto ↔ equipe pode ser N:N. O JSON `MK9_FALTAS_PROJECT_TEAMS` já expressa isso como `{UUID_projeto: [equipes.codigo]}`, sem migration ou mudança de parser. Essa solução basta se forem confirmadas equipes operacionais válidas, identidade de matrícula comum e regras de alocação compatíveis.

Uma tabela persistida **não está comprovadamente necessária apenas porque existem oito projetos e duas equipes**. Ela passa a ser justificável se forem necessários manutenção pela interface, auditoria de aprovação, períodos de vigência ou histórico de transferências. Nesse caso, propor separadamente relacionamento por UUID interno de equipe e UUID externo de projeto, com validade e aprovação; não reescrever rotas/visitas para criar esse vínculo.

Se os membros de uma mesma equipe pertencem a projetos diferentes, uma relação equipe ↔ projeto não descreve sozinha o efetivo por projeto. A API oficial informa o projeto de cada ocorrência, mas isso não fornece cadastro completo de promotores ativos sem ocorrências. Os indicadores atuais contam o efetivo da equipe em cada projeto mapeado e podem superestimar o total por projeto. Confirmada essa situação, será necessária alocação explícita **promotor ↔ projeto**, possivelmente com vigência, para indicadores corretos. Não usar UF/indústria como substituto dessa informação.

Se as matrículas dos sistemas forem diferentes, propor um **mapeamento explícito de identidades externas**, validado pelo responsável, preservando PRM e todas as referências existentes. Isso exigirá ajuste focado na integração; somente configuração projeto/equipe não resolverá. Não converter códigos por heurística nem alterar PKs/FKs operacionais.

### Inconsistências técnicas verificadas

- Nome de equipe é usado pela Gestão de Equipes; nome/código são aceitos por presença/permissões/integração. Uma futura decisão por IDs/códigos canônicos precisa de compatibilidade em todos esses consumidores. Não aplicar uma padronização em massa agora.
- O painel de presença chama `assign_attendance_supervisor`, definida na migration local `20261019013007_complete_attendance_operational_setup.sql`. Não foi encontrada rotina correspondente no banco consultado, em qualquer schema não sistêmico. Há divergência entre fonte local e banco: revisar o estado de implantação antes de escolher esse painel para executar correções. **Não apliquei a migration nem testei a operação de escrita.** Isso não autoriza refatorar ou migrar o módulo nesta tarefa.
- Os controles do banco e da integração possuem tratamentos distintos para gestor sem vínculo. Atribuir papel e user_id deve ser planejado como uma mudança de permissão, com validação de rotas/presença/fotos, e não mero preenchimento cadastral.

### Plano para futura aprovação

1. Responsável entrega matriz de alocação e confirma identidades, sem alteração automática.
2. Revisar linha por linha: valor atual, valor proposto, evidência, responsável aprovador e impacto de acesso.
3. Escolher: apenas configuração N:N; correção cadastral operacional; ou relacionamento adicional de identidade/alocação. Nenhuma opção está autorizada para execução nesta etapa.
4. Preparar uma correção piloto de uma pessoa/equipe, com conferência das 353 rotas e 12 visitas existentes antes/depois. Não modificar matrícula/rotas como atalho.
5. Quando autorizado, validar o acesso dos três perfis e o escopo das contas de supervisor no aplicativo inteiro.
6. Configurar uma nova credencial no servidor e executar homologação real. Build/testes anteriores só precisam ser repetidos quando houver mudança que justifique isso ou no gate final de merge.

## E. Informações que o responsável precisa fornecer

- Para cada promotor: matrícula local, matrícula MK9, equipe operacional real, supervisor responsável e projetos externos autorizados, com validade se aplicável.
- A definição operacional de cada projeto externo; esclarecer se representa praça, contrato, filial, região ou outro agrupamento.
- Se uma pessoa pode atuar em vários projetos e/ou equipes simultaneamente; no modelo atual ela tem somente uma equipe textual.
- Se BRASÍLIA corresponde a alguma equipe atual e qual documento/lista sustenta isso.
- Se “LUCAS” é LUCAS MATHEUS/SUP-002 e qual conta Auth pertence a ele.
- Quais contas devem representar PAULO GUSTAVO e Gustavo Jean e se devem manter seus papéis atuais.
- O destino da conta PROMOTOR TESTE.
- Confirmação de revogação da chave anterior; nova credencial apenas no ambiente seguro, nunca nesta documentação ou conversa.

## Anexo: inventário individual dos 44 promotores

Rotas, PDVs e indústrias são os vínculos atuais por matrícula, não evidência de projeto externo. Todos os supervisores textuais abaixo estão vazios e nenhuma equipe resolve os dois cadastros atuais. PDVs por promotor não devem ser somados para obter lojas globais distintas. Visitas indicam registros existentes, não atendimentos necessariamente concluídos.

| Matrícula original | Promotor | Equipe textual | Supervisor textual | Rotas | PDVs distintos | Indústrias nas rotas | Visitas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PRM-001 | CARLOS DA GUIA NUNES | — | — | 10 | 5 | IND-002, IND-007, IND-013, IND-017, IND-018, IND-019, IND-022 | 0 |
| PRM-001-2 | GÊNESIS PEREIRA SIQUEIRA | BRASÍLIA | — | 13 | 4 | IND-001, IND-002, IND-007, IND-009, IND-013, IND-018, IND-019, IND-022 | 0 |
| PRM-002 | ANTONIA AMANDA SIEBRA BATISTA | BRASÍLIA | — | 9 | 4 | IND-006, IND-013, IND-016, IND-017, IND-018, IND-022 | 0 |
| PRM-003 | FRANCISCO PEREIRA MASCIMO | — | — | 8 | 6 | IND-013, IND-018, IND-022 | 0 |
| PRM-004 | SAMILLE APARECIDA DOS SANTOS DAMASCENO BARBOSA | BRASÍLIA | — | 13 | 6 | IND-002, IND-004, IND-007, IND-013, IND-018, IND-019, IND-021, IND-022 | 0 |
| PRM-006 | MILLENA CONCEICAO MOURA CRUZ | — | — | 0 | 0 | — | 0 |
| PRM-007 | FRANKLIN MATOS RODRIGUES | BRASÍLIA | — | 12 | 5 | IND-001, IND-002, IND-007, IND-009, IND-013, IND-018, IND-019, IND-021, IND-022 | 0 |
| PRM-008 | GRAZIELE MELO SILVA ALVES | BRASÍLIA | — | 14 | 7 | IND-001, IND-002, IND-004, IND-009, IND-013, IND-019, IND-022 | 0 |
| PRM-012 | GUILHERME RODRIGUES SILVA DE LIMA | BRASÍLIA | — | 0 | 0 | — | 0 |
| PRM-015 | FRANCISCO JOSE DOS SANTOS LOURENÇO | — | — | 11 | 6 | IND-001, IND-005, IND-013, IND-019, IND-023 | 0 |
| PRM-016 | YAGO BORGES DE QUEIROZ | — | — | 25 | 18 | IND-003, IND-023, IND-024 | 0 |
| PRM-017 | JONAS DUARTE DA SILVA | — | — | 17 | 10 | IND-001, IND-003, IND-004, IND-005, IND-013, IND-014, IND-019, IND-021 | 0 |
| PRM-018 | MARCIO JERONIMO ALVES | — | — | 13 | 9 | IND-003, IND-005, IND-013, IND-014, IND-021, IND-023 | 0 |
| PRM-019 | ROGERIO PEREIRA BARBOSA | — | — | 18 | 11 | IND-001, IND-003, IND-005, IND-013, IND-014, IND-019, IND-023, IND-024 | 0 |
| PRM-021 | CAMILA TRINDADE DE OLIVEIRA | — | — | 0 | 0 | — | 0 |
| PRM-022 | MARCELO AUGUSTO DE OLIVEIRA PEREIRA GOMES | — | — | 13 | 6 | IND-001, IND-003, IND-005, IND-013, IND-019, IND-021, IND-024 | 0 |
| PRM-023 | FABIO CAMARGO DOS SANTOS | — | — | 12 | 7 | IND-001, IND-005, IND-013, IND-014, IND-021, IND-023 | 0 |
| PRM-024 | BRENNO FELIPE GOMES DA SILVA | — | — | 13 | 10 | IND-001, IND-003, IND-005, IND-023, IND-024 | 1 |
| PRM-025 | MATHEUS RIBEIRO SILVA | — | — | 11 | 7 | IND-001, IND-013, IND-016, IND-018, IND-019, IND-024 | 0 |
| PRM-026 | RODRIGO MARQUES DE OLIVEIRA | — | — | 18 | 13 | IND-003, IND-023, IND-024 | 0 |
| PRM-028 | LUCAS PEREIRA DE FARIA SILVA | — | — | 1 | 1 | IND-010 | 0 |
| PRM-029 | SIMONE DE JESUS PEREIRA | — | — | 0 | 0 | — | 0 |
| PRM-030 | FERNANDA KELLY ALVES DA SILVA | — | — | 3 | 2 | IND-001, IND-010, IND-019 | 0 |
| PRM-031 | KEVEN ALBERTO PAULINO DE SOUSA | — | — | 15 | 7 | IND-001, IND-008, IND-009, IND-010, IND-013, IND-019 | 0 |
| PRM-033 | ANA LETICIA ORTIZ AVALO | — | — | 4 | 4 | IND-013 | 0 |
| PRM-034 | JEFFERSON JUNIOR DE SOUZA | — | — | 0 | 0 | — | 0 |
| PRM-036 | NUBIA FLAVIA LEITE | — | — | 0 | 0 | — | 0 |
| PRM-037 | JHONATTA WISNNER GONÇALVES | — | — | 0 | 0 | — | 0 |
| PRM-038 | LUCAS MATHEUS MOREIRA SILVA | — | — | 0 | 0 | — | 0 |
| PRM-044 | PRISCYLLA GOMES DA SILVA | BRASÍLIA | — | 10 | 7 | IND-002, IND-007, IND-013, IND-018, IND-021 | 0 |
| PRM-050 | RAFAELA SILVA GOMES | — | — | 0 | 0 | — | 0 |
| PRM-054 | PAULO VICTOR RODRIGUES DE ALMEIDA | BRASÍLIA | — | 13 | 6 | IND-002, IND-004, IND-006, IND-009, IND-013, IND-017, IND-019, IND-021, IND-022 | 0 |
| PRM-055 | THAYZA DE OLIVEIRA PEREIRA | — | — | 1 | 1 | IND-021 | 0 |
| PRM-060 | KAYQUE DE JESUS OLIVEIRA | — | — | 17 | 9 | IND-001, IND-003, IND-008, IND-013, IND-019, IND-021, IND-023, IND-024 | 3 |
| PRM-061 | ALINE DA SILVA PROCOPIO | — | — | 0 | 0 | — | 0 |
| PRM-062 | ROSILENE DA SILVA GONCALVES GAMBARRA | — | — | 13 | 13 | IND-013 | 0 |
| PRM-064 | ERIK MATHEUS DE SOUZA MENDES | — | — | 0 | 0 | — | 0 |
| PRM-065 | ANDERSON WILLIAMS SANTOS TORRES | — | — | 13 | 7 | IND-002, IND-007, IND-013, IND-018, IND-019, IND-021, IND-022 | 1 |
| PRM-068 | YURE PEREIRA DA SILVA | BRASÍLIA | — | 16 | 6 | IND-001, IND-002, IND-004, IND-007, IND-009, IND-013, IND-017, IND-018, IND-019, IND-022 | 5 |
| PRM-126 | GABRIEL TERRA ANDRADE PORTELLA | — | — | 13 | 8 | IND-001, IND-003, IND-005, IND-013, IND-014, IND-021 | 0 |
| PRM-723 | DANIEL ALEXANDRE DE ALMEIDA | — | — | 0 | 0 | — | 0 |
| PRM-7524 | GUSTAVO JEAN | — | — | 4 | 4 | IND-002, IND-008, IND-013 | 2 |
| PRM-8937 | PAULO GUSTAVO | — | — | 0 | 0 | — | 0 |
| PRM-SEM | THALLYSON WILLIAM DE SOUSA SILVA | — | — | 0 | 0 | — | 0 |

### Referências locais inspecionadas

- [equipesService.ts](../src/lib/equipesService.ts): métricas, listagem pelo nome e transferência.
- [RoutesView.tsx](../src/views/RoutesView.tsx): joins de rota com promotor/indústria/loja.
- [attendanceEngine.ts](../src/utils/attendanceEngine.ts): resolução de supervisor e composição da presença.
- [attendanceAdministration.ts](../src/lib/attendanceAdministration.ts): chamada da RPC de atribuição.
- [SupervisorsManagementView.tsx](../src/views/SupervisorsManagementView.tsx): compatibilidade de supervisor por nome/ID.
- [PromotersView.tsx](../src/views/PromotersView.tsx): geração e edição da matrícula local.
- [rh-handler.ts](../server/rh-handler.ts): autorização da integração.
- [mk9-faltas.ts](../server/mk9-faltas.ts): formato do mapeamento.
- Funções implantadas `attendance_private.staff_can_access` e `can_read_visit`: definição consultada por SELECT; nenhuma execução com efeitos de escrita.

Estado: **diagnóstico concluído; correções e alterações técnicas aguardam aprovação explícita.**

