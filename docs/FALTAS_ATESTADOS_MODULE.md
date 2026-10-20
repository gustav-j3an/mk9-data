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

O rascunho não é persistido. A revisão informa **“Não enviado — integração com CRM aguardando homologação.”** O histórico fica vazio. Não há POST, fila, protocolo, confirmação ou envio automático.

A especificação `MK9_RH_API_ESCRITA_ESPECIFICACAO.md` é uma proposta e não confirma endpoint nem contrato de escrita. Antes de qualquer envio será necessário obter o contrato oficial, homologar credenciais e projetos de teste, definir idempotência, unidade da ocorrência, estados, erros, retorno e auditoria.

## Independência operacional

O módulo usa apenas a RPC de capability e a RPC de leitura de vínculos CRM para identificação. Não lê nem altera registros, tabelas ou RPCs do Controle de Presença, escalas, faltas operacionais, visitas ou rotas. A consulta GET existente é mostrada apenas como estado de acesso de leitura e não habilita escrita.

## Testes

- Testes unitários: `npm run test:faltas-atestados`.
- Teste SQL de capability: `supabase/tests/mk9_faltas_atestados_prepare_permission.sql`, apenas em banco local sintético e dentro de transação com rollback.
- Typecheck: `npm run lint`.
- Build: `npm run build`.
- Bundle: conferir que não inclui endpoint/cliente POST, credenciais ou segredos. Nenhuma validação visual é afirmada sem capturas reais.
