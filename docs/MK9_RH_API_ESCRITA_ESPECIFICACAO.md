# Especificação proposta: envio de ausências ao CRM MK9

**Estado:** proposta para discussão com o responsável pelo CRM. Os endpoints e o contrato abaixo não estão confirmados no repositório e não devem ser tratados como API disponível.

## 1. Objetivo e fluxo

O MK9 Date é a origem dos lançamentos feitos no Controle de Presença. O CRM MK9 Faltas e Atestados é o destinatário. A integração deve transmitir apenas lançamentos autorizados, preservar o histórico local e permitir confirmação, tratamento de falhas e reenvio seguro.

Fluxo pretendido:

    Controle de Presença → persistência e auditoria MK9 Date → fila server-side → API do CRM → confirmação no MK9 Date

A consulta GET /api/integracoes/ausencias permanece separada e inalterada. Sua existência não implica suporte a escrita.

## 2. Campos disponíveis no MK9 Date

Campos conferidos nas migrations locais. Eles descrevem o schema de origem, não um mapeamento aceito pelo CRM.

| Tabela | Campos existentes relevantes | Limites para integração |
|---|---|---|
| promoter_attendance_records | id UUID; promotor_matricula (matrícula local); data_operacional; override_status (presente, falta, atestado_pendente, atestado_aprovado, sem_registro); medical_days; justification; created_at/created_by; updated_at/updated_by. Unicidade por matrícula local e data. | Ajuste diário; não tem data final, tipo CRM, projeto, chave idempotente ou protocolo externo. medical_days é quantidade informada, não intervalo validado. justification pode conter dados sensíveis e não deve ser enviado por padrão. |
| promoter_attendance_audit_log | id; record_id; matrícula local; data operacional; instante; autor UUID/nome/e-mail; previous_value e new_value; justificativa. | Trilha local, não fila de integração. Não transmitir e-mail, justificativa ou snapshots sem necessidade e aprovação. |
| promoter_absences | id; matrícula local; tipo (folga, ferias, licenca_medica, afastamento, licenca_paternidade, outro; migration posterior também admite feriado); data_inicio/data_fim; motivo, justificativa, aprovado_por, data_aprovacao, observacao; timestamps e autores UUID. | Períodos operacionais, não necessariamente ocorrência de falta/atestado do CRM. Sem projeto ou matrícula externa; textos podem ser sensíveis. |
| promotores | id UUID; matricula única; nome; cpf, telefone, email; cidade, uf; supervisor, equipe; status; timestamps. | Dados pessoais. Usar matrícula externa e projeto aprovados; não presumir equivalência com matrícula local nem enviar CPF/contato sem requisito aprovado. |
| mk9_identidades | promotor_id UUID; usuario_id UUID opcional; estado; aprovador/instante; referencia; timestamps. | Liga identidade local à conta do app. Não contém matrícula externa. Acesso direto é negado por RLS; RPC privada fornece escopo limitado. |
| mk9_alocacoes | id; promotor_id; projeto_externo_id UUID; matricula_externa; janela de ocorrências ocorrencias_desde/ocorrencias_ate; vigência valido_desde/valido_ate; estado; aprovador/instante; referencia; versão, histórico e timestamps. | Fonte candidata para projeto e matrícula externa, somente se identidade e alocação forem aprovadas e vigentes. A migration atual limita os projetos a oito UUIDs; vínculo não prova autorização de escrita no CRM. |
| mk9_acessos | id; usuario_id; alocacao_id; tipo supervisao/gestao; estado; vigência; aprovador/instante; referencia; versão e timestamps. | Autoriza visualização RH local por alocação; não é autorização de envio. O backend de envio deve revalidar perfil e escopo apropriado. |

Referências do schema: migrations 20261018220000_create_promoter_attendance_audit.sql, 20261018230000_create_promoter_schedules_and_absences.sql, 20261019151754_mk9_rh_explicit_bindings.sql, 20260930_create_import_tables.sql e 20260930_create_profiles.sql.

O Controle de Presença salva um ajuste diário por promotor local via RPC set_promoter_attendance_override, persistindo o ajuste e uma linha de auditoria. A tabela promoter_absences é uma estrutura distinta usada para folgas/licenças/períodos pelo motor de presença. Não converter automaticamente uma tabela na outra.

## 3. Campos necessários do lado do CRM

| Campo lógico | Proposta de origem | O CRM precisa confirmar |
|---|---|---|
| Identificador idempotente | UUID estável de lançamento/evento, junto de source_system, source_record_id e source_version. | Campos aceitos, escopo de unicidade, retenção e resposta a repetição/conflito. |
| Colaborador | matricula_externa da alocação aprovada; incluir nome só se necessário. | Se a matrícula identifica inequivocamente, normalização e se exige outro identificador. Não presumir UUID ou matrícula local no CRM. |
| Projeto | projeto_externo_id da alocação aprovada. | Tipo/formato aceito e como a credencial é restringida por projeto. |
| Tipo | Mapeamento explícito de falta ou atestado_aprovado. Não enviar outros status até regra aprovada. | Enumerações e se atestado_pendente pode ser recebido ou somente atestado aprovado. |
| Datas | Data operacional ou intervalo explicitamente aprovado. | Inclusividade, formato ISO, fuso, data de retorno e validação. |
| Quantidade de dias | Omitir se calculado pelo CRM; não derivar intervalo de medical_days sem regra. | Obrigatoriedade; dias corridos/úteis; inclusão das pontas e arredondamento. |
| Referência administrativa | Referência opaca de origem e ID local; não enviar justificativa livre por padrão. | Campo, tamanho, formato e protocolo aceitos. |
| Auditoria | Autor e instante podem permanecer locais. | Se CRM exige responsável e qual identificador aceita. |
| Anexos | Nenhum no contrato inicial proposto. | Se obrigatório para atestado; formato, tamanho, upload, criptografia, retenção e controle de acesso. |

CPF, telefone, e-mail, CID, diagnóstico, justificativa livre, observação, documentos médicos, coordenadas e dados de rota ficam fora da proposta mínima. Inclusão exige necessidade documentada, revisão de privacidade e aprovação.

## 3.1 Resolução de identidade e administração dos vínculos

O MK9 Date mantém duas chaves distintas: a matrícula interna (por exemplo, PRM-068), usada por presença, visitas e rotas, e a matrícula externa real do CRM, guardada em mk9_alocacoes. O fluxo não atualiza nem substitui a chave interna. Não se infere matrícula externa por nome, CPF, equipe, indústria ou UF.

mk9_identidades associa o UUID do promotor à conta do app, quando houver correspondência autenticada. mk9_alocacoes associa o promotor local, matrícula externa e UUID de projeto externo, com estado, vigência e janela de ocorrências. Uma identidade pode ter várias alocações de projeto; cada par de projeto e matrícula externa é único e não pode ser reutilizado silenciosamente após revogação. Equipes operacionais não representam projetos externos.

O preparo administrativo deve gerar somente estado pendente. Papel admin operacional, sozinho, não concede administração de vínculos: exige uma permissão específica da integração provisionada por operador de banco autorizado. A tela do promotor lista matrícula interna, eventual conta associada, matrícula externa, UUID de projeto, janelas/vigência, estado e aprovação/responsável quando presentes. Nenhuma tela pode aprovar ou ativar automaticamente um vínculo. A aprovação continua uma revisão administrativa separada e registrada.

A lista e a preparação são feitas por RPCs server-side com validação de sessão, papel admin ativo e concessão específica. As tabelas continuam sem acesso direto via Data API por RLS/grants. A consulta de prontidão para um admin exige também a concessão de administração RH específica; para um gestor, exige acesso RH aprovado à alocação correspondente. A matrícula externa nunca é aceita como parâmetro de uma futura operação de envio diretamente do navegador: o backend deve resolvê-la no banco. A associação a uma conta local, se criada na preparação, só usa a relação persistida profiles.promotor_matricula = promotores.matricula; múltiplas contas correspondentes bloqueiam o preparo.

Para um lançamento do Controle de Presença, o servidor recebe a matrícula local e data operacional já persistidas, verifica escopo admin/gestor da presença e resolve identidade e alocações aprovadas, vigentes e dentro da janela de ocorrências. Zero vínculos, estado pendente/revogado, janela vencida e mais de uma alocação válida são situações distintas e bloqueiam qualquer futura transmissão; projeto não será escolhido por equipe, UF ou indústria. A consulta de prontidão é informativa e não envia dados nem cria fila. Se essa consulta falhar, o salvamento local continua normalmente.

A seleção entre múltiplas alocações permanece pendente de regra de negócio. Até o CRM aprovar a unidade de ocorrência (dia ou período), a preparação não agrupa ajustes diários e não altera presenças, visitas ou rotas.

O contrato oficial da API de escrita continua necessário antes de qualquer POST: endpoint, campos, autenticação e escopo de projeto, idempotência, confirmação, atualização/cancelamento, limites e regras de anexo precisam ser confirmados pelo responsável do CRM.

## 4. Contrato proposto — endpoints não confirmados

Os caminhos abaixo são sugestões para negociação, não rotas existentes. O CRM pode propor outro contrato com garantias equivalentes.

### Criar ocorrência

Proposta: POST /api/integracoes/ausencias, autenticado servidor a servidor, com Bearer e Idempotency-Key. O CRM deve limitar a credencial aos projetos aprovados.

    POST /api/integracoes/ausencias
    Authorization: Bearer <credencial-server-side>
    Idempotency-Key: mk9-date:attendance:<uuid-do-evento>
    Content-Type: application/json

Exemplo fictício:

    {
      "source_system": "mk9-date",
      "source_record_id": "0abf0c8d-f14e-48a8-98bf-e728e2aa8920",
      "source_version": 3,
      "matricula": "EXT-00421",
      "projeto_id": "950edb7d-b94f-4555-9e5a-16fb5aa857a3",
      "tipo": "FALTA",
      "data_inicio": "2026-10-19",
      "data_fim": "2026-10-19",
      "referencia_origem": "mk9-date:0abf0c8d-f14e-48a8-98bf-e728e2aa8920:v3"
    }

Matrícula, UUIDs, enumerações e nomes de campos são ilustrativos até confirmação. Não foi demonstrado que o CRM tenha uma rota POST.

Resposta síncrona sugerida:

    {
      "ok": true,
      "id": "crm-occurrence-8172",
      "protocolo": "FAL-2026-008172",
      "source_record_id": "0abf0c8d-f14e-48a8-98bf-e728e2aa8920",
      "status": "recebido",
      "received_at": "2026-10-19T14:22:31Z",
      "duplicate": false
    }

Todos os campos dessa resposta são exemplos a confirmar. Se o processamento for assíncrono, a API deve devolver identificador rastreável e método autenticado de consulta.

### Consultar confirmação

Sugestão se o CRM processar assincronamente: GET /api/integracoes/ausencias/por-origem/{source_record_id}. Deve retornar referência de origem, projeto, estado, protocolo e versão recebida, sem dados médicos desnecessários. O CRM deve confirmar se oferece essa operação ou consulta por outra chave.

### Atualizar ocorrência

Sugestão: PATCH /api/integracoes/ausencias/{id}, com source_version monotônica e referência de origem. Só habilitar após definir campos editáveis, concorrência, janela e mecanismo condicional (por exemplo, versão/ETag). Versão antiga deve ser rejeitada; repetição da mesma versão deve ser idempotente.

### Cancelar ocorrência

Sugestão: POST /api/integracoes/ausencias/{id}/cancelamento, com motivo codificado e referência de origem. Não apaga o registro local nem seu histórico. CRM precisa definir autorização, motivos, prazo, reversibilidade e efeito de auditoria. Não habilitar sem suporte confirmado e aprovação explícita no MK9 Date.

## 5. Ausências de vários dias

Os registros atuais são diários e únicos por promotor/data. Para uma ausência contínua de vários dias, não enviar um POST por dia nem consolidar dias adjacentes automaticamente: isso pode duplicar ocorrências ou combinar lançamentos independentes.

Proposta: preservar as linhas diárias e criar, após aprovação de usuário autorizado, um agrupamento explícito de transmissão com intervalo, tipo e referências das linhas de origem. A chave idempotente identifica o agrupamento/versionamento. Cada linha diária fica ligada a esse agrupamento para rastreabilidade. Antes da implementação, o CRM precisa definir se a unidade é um dia ou um período, como tratar lacunas, sobreposições e alterações. Não alterar visitas, rotas, check-ins, check-outs ou registros existentes como efeito colateral.

## 6. Segurança e operação

- **Autenticação:** segredo somente em backend/secret manager; nunca em variável VITE_, frontend ou logs. Preferir credencial de escrita separada da credencial GET, se suportado, com menor escopo possível.
- **Autorização:** restringir credencial no CRM aos projetos aprovados. Antes de cada envio/reenvio, o servidor MK9 Date revalida sessão, perfil ativo, escopo administrativo/equipe, identidade e alocação aprovada/vigente, matrícula externa, projeto e janela.
- **Idempotência:** mesma chave e payload retornam a confirmação original. Mesma chave com payload diferente gera conflito, nunca segunda ocorrência silenciosa.
- **Fila/outbox:** persistir lançamento e tarefa de saída atomicamente, por RPC coordenadora ou extensão transacional aprovada. Enviar após o commit; não manter transação aberta durante HTTP.
- **Auditoria:** manter autor, instante, versão, alocação, chave, tentativas, estado e recibo. Resposta sanitizada; sem segredos ou dados médicos no log.
- **Retentativas:** retry limitado e com atraso progressivo para rede, 429 e 5xx, respeitando Retry-After. Erros permanentes 4xx ficam suspensos para revisão. Reutilizar a mesma chave idempotente.
- **Timeout incerto:** consultar pelo identificador idempotente antes de repetir. Sem consulta nem idempotência garantida, marcar resultado incerto para reconciliação, sem retry cego.
- **Minimização:** transmitir somente identificadores e dados operacionais necessários. CID/diagnóstico, justificativa, anexos e contatos ficam excluídos por padrão. Restringir acesso à fila e protocolos.
- **Anexos:** não enviar inicialmente. Se obrigatórios, exigir upload autenticado separado, criptografia, tipo/tamanho limitados, verificação de malware, acesso de curta duração e política de retenção.
- **Revogação:** revogar no CRM e interromper envios no MK9 Date. Alocação revogada suspende itens pendentes do escopo; não usar credencial alternativa.
- **Falha parcial:** falha externa não reverte silenciosamente o lançamento local. Apresentar pendente, confirmado, falha ou resultado incerto e permitir reconciliação auditável.

## 7. Interface proposta

Manter a funcionalidade em AttendanceControlView, reutilizando o formulário, histórico e padrões visuais. Exibir status de sincronização separado do estado operacional, instante de confirmação e protocolo externo. Falha deve oferecer mensagem segura; reenvio é ação explícita, autorizada e reutiliza a chave idempotente. Exibir tentativas/última falha sanitizada e opção de consultar/reconciliar.

Não criar módulo principal novo, não autenticar o CRM no navegador e não alterar a semântica atual. A confirmação local continua visível quando o CRM estiver indisponível.

## 8. Erros e duplicidades

O CRM deve definir códigos estáveis para payload inválido (400/422), autenticação (401), autorização/projeto (403), referência inexistente (404), conflito de versão/chave (409), limite (429) e falha transitória (5xx). Corpo de erro não deve ecoar conteúdo sensível. O MK9 Date traduz códigos conhecidos para mensagens seguras e não expõe corpo bruto.

Sucesso deve distinguir criação de repetição e retornar referência/protocolo estável. O cliente só marca confirmado após correlacionar a resposta ao evento pendente. Timeout não comprova falha definitiva; consultar por referência idempotente antes do reenvio.

## 9. Perguntas ao responsável pelo CRM

1. Existe API de escrita? Qual URL-base de homologação, endpoint e método oficiais?
2. Quais campos, formatos, enums e identificadores são obrigatórios? Matrícula externa + UUID de projeto identificam o colaborador sem ambiguidade?
3. A unidade é lançamento diário ou ausência por período? Como calcular dias, retorno, dias úteis e sobreposições?
4. Quais status devem ser recebidos? atestado_pendente pode ser criado? Falta exige revisão antes do envio?
5. Há credencial de escrita separada, limitada por projeto/operação? Como emitir, rotacionar e revogar?
6. Como funciona a idempotência, por quanto tempo a chave é retida e o que ocorre em repetição ou payload divergente?
7. A escrita é síncrona? Como consultar confirmação após timeout e qual protocolo é estável?
8. Há atualização/cancelamento? Quais permissões, versões, motivos e prazos?
9. Anexo é obrigatório? Qual fluxo seguro, limites, retenção e controle de acesso?
10. Quais erros, limites de taxa, timeouts e Retry-After são usados?
11. Quais projetos e matrículas sintéticas usar em homologação e como o CRM verifica autorização?
12. Há ambiente de homologação e rotina para limpeza/reconciliação dos dados de teste?

## 10. Critérios de homologação

- Contrato e semântica de período aprovados pelos responsáveis dos dois sistemas.
- Credencial nova de escrita, separada da consulta se suportado, restrita a projeto de teste e somente no backend.
- Lançamento fictício aprovado, gravado localmente com trilha e sem dados médicos desnecessários enviados.
- Recibo/protocolo correlacionado ao evento e exibido na interface.
- Repetição após timeout retorna a mesma ocorrência, sem duplicação.
- Falhas 4xx, 429, 5xx, indisponibilidade e resultado incerto tratados e auditados conforme contrato.
- Usuário sem permissão, alocação revogada, projeto ou matrícula divergente bloqueados antes do envio.
- Atualização/cancelamento testados somente se suportados e aprovados, com controle de versão.
- Registros diários, visitas, telemetria e rotas permanecem inalterados pelo sincronizador.
- Evidências sem segredos, documentos médicos, CID ou payload sensível em logs.

## 11. Limites desta especificação

Este documento é uma proposta para o CRM. Não implementa cliente POST, fila, migration ou tela. Nenhum endpoint de escrita, formato de resposta, escopo de credencial, enumeração de status ou requisito de anexo foi confirmado. A integração GET existente permanece fora do escopo e inalterada.
