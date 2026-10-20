# Módulo Faltas e Atestados

## Estrutura

O módulo aparece no menu como **Faltas e Atestados** e contém seis áreas: Visão geral, Nova ausência, Histórico de lançamentos, Colaboradores e matrículas, Projetos CRM e Configurações. `FaltasAtestadosModule.tsx` mantém as áreas e o rascunho do formulário em memória da tela. `faltasAtestados.ts` concentra validações e resolução de vínculos. `faltasAtestadosAccess.tsx` consulta a capability e condiciona navegação e interface.

## Permissões

A migration `20261020160000_mk9_faltas_atestados_prepare_permission.sql` cria uma concessão individual em `mk9_rh_private.absence_prepare_permissions`. A permissão não é concedida automaticamente a administradores. A função `mk9_faltas_atestados_can_prepare()` verifica usuário autenticado, perfil ativo, papel compatível e concessão ativa. A RPC `mk9_faltas_atestados_bindings()` repete a validação no backend antes de retornar vínculos; acesso direto à tabela privada é revogado.

O template `supabase/templates/mk9_faltas_atestados_permission.sql` provisiona uma conta por vez, com UUID de aprovador e referência administrativa. A migration não deve ser aplicada em produção sem o fluxo de revisão e aprovação do ambiente.

## Vínculos e formulário

O colaborador é identificado por `promotores.id`/matrícula interna. Projeto CRM e matrícula externa vêm da alocação correspondente em `mk9_alocacoes`; somente identidade e alocação aprovadas e vigentes podem ser selecionadas. A matrícula externa não é editável. O projeto permanece identificado pelo UUID registrado: não existe catálogo de nomes e o módulo não infere projeto por equipe, UF ou indústria.

O formulário tem quatro etapas: Colaborador, Ocorrência, Informações complementares e Revisão. Valida campos obrigatórios, datas, ordem do período e janela/vigência do vínculo. A contagem de dias corridos é informativa, pois a regra oficial de dias úteis e inclusão das datas ainda não foi confirmada. CID e anexos ficam desabilitados.

## Estado e limites

O rascunho não é persistido. A revisão informa **“Não enviado — integração com CRM aguardando homologação.”** A área Histórico consulta registros existentes no CRM por GET e é somente leitura. Não há POST, fila, gravação, confirmação nem envio automático.

A especificação `MK9_RH_API_ESCRITA_ESPECIFICACAO.md` é uma proposta e não confirma endpoint nem contrato de escrita. Antes de qualquer envio será necessário obter o contrato oficial, homologar credenciais e projetos de teste, definir idempotência, unidade da ocorrência, estados, erros, retorno e auditoria.

## Independência operacional

O módulo usa as RPCs de capability e leitura de vínculos CRM, além da consulta GET server-side com escopo RH aprovado. Não lê nem altera registros, tabelas ou RPCs do Controle de Presença, escalas, faltas operacionais, visitas ou rotas.

## Testes

- Testes unitários: `npm run test:faltas-atestados`.
- Testes da API RH: `npm run test:rh-integration`.
- Teste SQL de capability: `supabase/tests/mk9_faltas_atestados_prepare_permission.sql`, apenas em banco local sintético e dentro de transação com rollback.
- Typecheck: `npm run lint`.
- Build: `npm run build`.
- Bundle: conferir que não inclui endpoint/cliente POST, credenciais ou segredos. Nenhuma validação visual é afirmada sem capturas reais.

## Recebimento de registros externos

A tela Visão geral e a área Histórico consultam `GET /api/faltas-atestados/ausencias`, uma rota interna do MK9 Date. Ela aceita `view=mine|team|management`, `data_inicio` e `data_fim`. A rota valida sessão, a capability `mk9_faltas_atestados_can_prepare()` e o escopo `mk9_rh_scope()` para a visão solicitada. A resposta é privada e `no-store`; tentativas de escrita são recusadas.

No servidor, essa rota reutiliza o GET externo já existente `GET /api/integracoes/ausencias`, autenticado por `Authorization: Bearer` com `MK9_FALTAS_API_KEY` somente no servidor. O host precisa usar HTTPS. O servidor envia `projeto_id`, matrícula externa e datas para cada alocação autorizada. Nenhuma chamada ao CRM com credenciais é feita pelo navegador.

### Contrato confirmado no código

O código do provedor usa os parâmetros `projeto_id`, `matricula`, `data_inicio`, `data_fim` e `limit=100`. A resposta esperada contém `ok`, `data` e, opcionalmente, `meta.limit`/`meta.count`. Para cada ocorrência, a projeção reconhece:

- Identidade: `id` (ou `protocolo` como chave de deduplicação), `protocolo`.
- Colaborador: `colaborador.matricula`, `colaborador.nome`.
- Projeto: `projeto.id`, `projeto.nome`.
- Tipo: `tipo.categoria` (`FALTA`, `ATESTADO` ou outra categoria, apresentada como “Ausência”).
- Período: `periodo.inicio`, `periodo.fim`, `periodo.retorno`, `periodo.dias`.
- Situação: `status`, `status_processamento`, mapeados para estados de exibição conhecidos.

A rota de recebimento mantém ID externo, protocolo, UUID de projeto e matrícula externa no DTO do módulo. A camada de normalização associa o par UUID de projeto + matrícula externa ao vínculo local aprovado e vigente; nome não é usado para associação. A apresentação usa a matrícula interna e nome local do vínculo. A associação ausente ou ambígua é omitida e contabilizada sem revelar dados do registro.

### Limites e segurança dos dados

O provedor não tem contrato de cursor/offset confirmado. O servidor consulta com limite 100, particiona intervalos saturados em janelas menores e deduplica pelo projeto, matrícula e ID. Se um único dia atingir o limite ou o orçamento seguro da requisição, a consulta falha sem apresentar totais parciais. O intervalo solicitado é limitado a um ano; o backend usa timeout e orçamento de chamadas. A interface oferece atualização manual e filtros de período, projeto, tipo e matrícula, aplicados apenas sobre o conjunto completo retornado para o escopo autorizado.

Campos desconhecidos, CID, diagnóstico, documentos médicos, anexos, observações e justificativas não são projetados para a resposta do módulo. Respostas incompletas ou incompatíveis geram estado de erro. As visões de escopo RH continuam sujeitas à validação server-side e a revalidação dos vínculos depois da consulta externa.

A rota interna não é endpoint oficial de escrita do CRM. GET não confirma o contrato de POST. O módulo não envia, persiste ou altera ocorrências externas. Sincronização futura ainda depende do contrato oficial, regras de atualização/cancelamento, idempotência e homologação do CRM.
