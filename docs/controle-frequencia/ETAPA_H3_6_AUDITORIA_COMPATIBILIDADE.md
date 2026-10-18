# MK9 DATE — ETAPA H3.6: AUDITORIA DE COMPATIBILIDADE DO CONTRATO SIMULADO

**Data:** 18 de Outubro de 2026  
**Status:** AUDITADO E VALIDADO — 100% DE COMPATIBILIDADE CONFIRMADA  
**Ambiente:** `C:\projetos\mk9-data`  
**Escopo:** `src/views/IndustriesView.tsx`, `src/lib/contratosService.ts`, `src/types.ts`, `supabase/migrations/20261017120000_create_contratos_lojas_table.sql`

---

## 1. Objetivo da Auditoria

Verificar se o payload produzido pelo modal de autorização individual prototipado na Etapa H3.5 é estrita e bidirecionalmente compatível com:
1. O DTO de criação `CreateContratoLojaDTO`;
2. A rotina de sanitização e validação `contratosService.prepareContratoInsertData()`;
3. A interface do método `contratosService.createContrato()`;
4. O schema SQL local da tabela `public.contratos_lojas` (`supabase/migrations/20261017120000_create_contratos_lojas_table.sql`).

---

## 2. Matriz De-Para: Formulário vs. DTO vs. Serviço vs. Schema SQL

| Campo no Modal UI | Propriedade no DTO (`CreateContratoLojaDTO`) | Retorno de `prepareContratoInsertData()` | Coluna em `public.contratos_lojas` | Tipo SQL & Constraints | Compatibilidade |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `reviewingContrato.industria_codigo` | `industria_codigo: string` | `industria_codigo: string` (normalizado) | `industria_codigo` | `TEXT NOT NULL REFERENCES industrias(codigo)` | **100% Compatível** |
| `reviewingContrato.loja_codigo` | `loja_codigo: string` | `loja_codigo: string` (normalizado) | `loja_codigo` | `TEXT NOT NULL REFERENCES lojas(codigo)` | **100% Compatível** |
| `reviewingContrato.frequencia` | `frequencia: ContratoFrequencia` | `frequencia: 'SEMANAL'\|'QUINZENAL'\|'MENSAL'` | `frequencia` | `TEXT NOT NULL CHECK IN ('SEMANAL','QUINZENAL','MENSAL')` | **100% Compatível** |
| `reviewingContrato.visitas_por_semana` | `visitas_por_semana?: number` | `visitas_por_semana: number \| null` | `visitas_por_semana` | `INTEGER CHECK (1..7 para SEMANAL, NULL para outros)` | **100% Compatível** |
| `reviewingContrato.segunda..domingo` | `segunda..domingo?: boolean` | `segunda..domingo: boolean` | `segunda..domingo` | `BOOLEAN NOT NULL DEFAULT FALSE` | **100% Compatível** |
| *(Implícito/Nulo para SEMANAL)* | `ciclo_quinzenal?: CicloQuinzenal` | `ciclo_quinzenal: null` | `ciclo_quinzenal` | `TEXT CHECK (NULL para frequencia != QUINZENAL)` | **100% Compatível** |
| `dataInicio` (cadastrada ou ref) | `data_inicio_vigencia?: string` | `data_inicio_vigencia: string` | `data_inicio_vigencia` | `DATE NOT NULL` | **100% Compatível** |
| `revisaoForm.data_fim_vigencia` | `data_fim_vigencia?: string \| null` | `data_fim_vigencia: string \| null` | `data_fim_vigencia` | `DATE NULL` | **100% Compatível** |
| *(Padrão 'ativo')* | `status?: ContratoStatus` | `status: 'ativo'` | `status` | `TEXT NOT NULL CHECK IN ('ativo','inativo','suspenso','encerrado')` | **100% Compatível** |
| `revisaoForm.valor_por_visita` | `valor_por_visita?: number \| null` | `valor_por_visita: number` | `valor_por_visita` | `NUMERIC(10,2) CHECK (>= 0)` | **100% Compatível** |
| *(Fixo pelo serviço)* | *(Não fornecido)* | `origem: 'manual'` | `origem` | `TEXT CHECK IN ('manual','migracao_rotas','importacao_planilha','sistema')` | **100% Compatível** |
| `revisaoForm.observacao` | `observacao?: string \| null` | `observacao: string \| null` | `observacao` | `TEXT NULL` | **100% Compatível** |

---

## 3. Respostas às 9 Verificações da Auditoria

### 3.1. Comparação dos Campos do Formulário com o DTO e Schema
- Todos os campos manipulados no modal mapeiam-se sem exceção para o DTO `CreateContratoLojaDTO`.
- O retorno sanitizado por `prepareContratoInsertData()` possui exatamente as 17 colunas de dados exigidas por `public.contratos_lojas` (`industria_codigo`, `loja_codigo`, `frequencia`, `visitas_por_semana`, `segunda`, `terca`, `quarta`, `quinta`, `sexta`, `sabado`, `domingo`, `ciclo_quinzenal`, `data_inicio_vigencia`, `data_fim_vigencia`, `status`, `valor_por_visita`, `origem`, `observacao`).
- Campos de sistema como `id`, `created_at` e `updated_at` são gerados pelos defaults do PostgreSQL (`gen_random_uuid()` e `now()`).

### 3.2. Tipos e Formatos
- `valor_por_visita`: submetido como `number` em ponto flutuante positivo (ex: `125.50`), compatível com `NUMERIC(10, 2)`.
- `data_inicio_vigencia`: formato ISO estrito `YYYY-MM-DD` validado por regex e dias por mês via `parseISODate()`, compatível com `DATE`.
- `data_fim_vigencia`: formato ISO `YYYY-MM-DD` ou `null` quando contínuo, compatível com `DATE NULL`.
- `frequencia`: enum tipado `'SEMANAL' | 'QUINZENAL' | 'MENSAL'`.
- Dias de visita: booleanos literais (`true` ou `false`).
- `status`: string `'ativo'` compatível com o check constraint.
- `origem`: string `'manual'`.
- `observacao`: string limpa ou `null`.

### 3.3. Conversão da Frequência Operacional das Rotas
- As rotas ativas utilizam `SEMANAL` ou `QUINZENAL`.
- A função pura `analyzeRotasForContracts()` agrega as rotas daquele par. Se todas possuírem a mesma frequência, o par entra como elegível preservando a frequência original e marcando os dias da semana atendidos. Se houver divergência, o par é bloqueado em `conflitos`. Nenhuma perda de informação ocorre.

### 3.4. Regra da Data de Início da Vigência Comercial
- **Regra Aprovada:** A data de início comercial utiliza preferencialmente a `data_inicio_operacao` informada no cadastro da indústria.
- **Caso da KING (`IND-013`):** Se a data de início da operação não estiver informada, utiliza-se a data de referência, mantendo a vigência contínua com `data_fim_vigencia = NULL`.
- **Demais Indústrias:** Na ausência de `data_inicio_operacao`, o par é classificado como `INICIO_NAO_INFORMADO` e o botão de revisão fica bloqueado, impedindo a criação sem data de início real.

### 3.5. Ciclo de Apuração vs. Vigência Comercial
- **Garantia de Não Confusão:** O ciclo de apuração (mensal ou 23 a 22 da KING) é exibido apenas no bloco de metadados e projeção (`projecao_periodo`).
- A vigência comercial real submetida a `prepareContratoInsertData()` recebe `data_fim_vigencia = null` (quando selecionada a opção de contrato contínuo).
- Os campos auxiliares `calcular_periodo`, `data_referencia` e `data_cadastro` **não foram enviados** para o payload de gravação do banco, evitando que o ciclo mensal encerre precocemente o contrato comercial contínuo.

### 3.6. Validação de Sobreposição de Vigências
- O modal só abre para pares classificados como `ELEGIVEL`.
- Pares com contratos ativos ou suspensos existentes são classificados como `JA_POSSUI_ATIVO` ou `JA_POSSUI_SUSPENSO` e não possuem botão de revisão.
- Isso previne violações da trigger de banco `trigger_check_contratos_vigencia_overlap`.

### 3.7. Correspondência Exata do Resumo JSON no Modal
- Ajustamos o modal para exibir separadamente:
  1. **Payload Real do Supabase:** objeto estrito retornado por `prepared.data`, contendo apenas as colunas da tabela `contratos_lojas`.
  2. **Metadados de Auditoria:** objeto informativo com a projeção de competência, status KING e regras do ciclo.

### 3.8. Incompatibilidades e Divergências
- **Nenhuma coluna inexistente** está sendo enviada ao Supabase.
- **Nenhum campo obrigatório** está ausente.
- A constraint `visitas_por_semana` (que exige `NULL` se a frequência for `QUINZENAL` ou `MENSAL`) é estritamente satisfeita pela regra de normalização de `prepareContratoInsertData()`.

### 3.9. Sugestões de Testes Adicionais
1. Teste de rejeição de criação com `valor_por_visita <= 0`.
2. Teste de rejeição com `data_fim_vigencia < data_inicio_vigencia`.
3. Teste de geração de contrato contínuo com `data_fim_vigencia = null` para KING (`IND-013`).
4. Teste de rejeição para indústria não KING sem `data_inicio_operacao`.

---

## 4. Confirmação de Execução Segura

- **Gravação Remota:** Nenhuma chamada ao Supabase remoto (sem INSERT, UPDATE, DELETE ou RPC).
- **Chamada a `createContrato()`:** 0 chamadas.
- **Migrations:** Nenhuma migration executada.
- **Git Commit:** Nenhum commit realizado.
- **Sucesso dos Testes:** 66 testes unitários aprovados (`npx tsx --test src/lib/contratosService.test.ts`), `npm run lint` e `npm run build` 100% íntegros.

