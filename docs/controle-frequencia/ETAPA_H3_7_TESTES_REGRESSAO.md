# MK9 DATE — ETAPA H3.7: TESTES DE REGRESSÃO DA AUTORIZAÇÃO DE CONTRATOS

**Data:** 18 de Outubro de 2026  
**Status:** CONCLUÍDO COM SUCESSO (81 TESTES APROVADOS, 0 FALHAS)  
**Ambiente:** `C:\projetos\mk9-data`  
**Escopo:** `src/lib/contratosService.test.ts`, `src/lib/contratosService.ts`, `src/views/IndustriesView.tsx`

---

## 1. Resumo Executivo

Na Etapa H3.7, implementamos uma nova suíte de testes de regressão automatizados para proteger integralmente o fluxo de **revisão, validação e preparação de contratos** antes da futura ativação de persistência no Supabase.

Foram adicionados **15 novos testes unitários**, elevando a cobertura de testes de 66 para **81 testes aprovados** (distribuídos em 22 suites), sem nenhuma falha e com 100% de integridade nos linters e builds do projeto.

---

## 2. Refatoração Pura Desacoplada: `classificarParContratual`

Para permitir o teste automatizado e isolado da lógica de elegibilidade e classificação de pares (indústria, loja) que antes residia apenas dentro do hook `useMemo` do React em `IndustriesView.tsx`:
1. Extraímos a lógica pura para a função `classificarParContratual()` em [contratosService.ts](file:///c:/projetos/mk9-data/src/lib/contratosService.ts).
2. O componente [IndustriesView.tsx](file:///c:/projetos/mk9-data/src/views/IndustriesView.tsx) passou a invocar diretamente essa função utilitária pura, eliminando duplicações e garantindo 100% de paridade entre o teste e o runtime.
3. Não houve nenhuma alteração nas regras de negócio aprovadas ou no comportamento visual da interface.

---

## 3. Cobertura da Nova Seção 8 de Testes

A nova suíte `8. Testes de Regressão da Autorização Individual e Preparação de Contratos` cobre:

### 3.1. Validação de Valor por Visita (3 testes)
- **Sucesso:** Aceita valores positivos com decimais em reais (ex.: `R$ 150.50`).
- **Rejeição:** Rejeita valores negativos (`-10`) através de `validateContratoPayload()`.
- **Compatibilidade:** Aceita `null` e `undefined` em `prepareContratoInsertData()` preservando compatibilidade do schema do banco quando o valor não for fornecido.

### 3.2. Vigência Comercial Contínua vs Determinada (4 testes)
- **Vigência Contínua:** Permite `data_fim_vigencia = null` (essencial para KING e contratos por prazo indeterminado).
- **Vigência Determinada:** Permite datas com início e término coerentes (ex.: `2026-10-01` a `2026-12-31`).
- **Coerência Temporal:** Rejeita vigência onde `data_fim_vigencia < data_inicio_vigencia`.
- **Integridade Calendária:** Rejeita datas inválidas no calendário (ex.: `2026-02-30`) e formatos incorretos via `parseISODate()`.

### 3.3. Preservação de Identificadores e Integridade de Payload (3 testes)
- **Normalização:** Preserva códigos de indústria e loja em caixa alta e sem espaços (`'  ind-099  '` -> `'IND-099'`).
- **Schema Estrito:** Assegura que o payload retornado por `prepareContratoInsertData()` contenha **APENAS** as colunas aceitas pelo schema SQL de `public.contratos_lojas`, garantindo a exclusão estrita de `calcular_periodo`, `data_referencia`, `data_cadastro`, `competencia`, `_meta` ou `metadata`.
- **Restrição de Frequência:** Assegura que `visitas_por_semana` seja `null` e `ciclo_quinzenal` seja mantido quando a frequência for `QUINZENAL` ou `MENSAL`.

### 3.4. Isolamento da Classificação e Elegibilidade `classificarParContratual` (5 testes)
- **`ERRO_CONSULTA`:** Ativado imediatamente se houver falha na consulta dos contratos (`contratosError`).
- **`JA_POSSUI_ATIVO`:** Ativado se o par possuir contrato vigente com status `'ativo'`.
- **`JA_POSSUI_SUSPENSO`:** Ativado se o par possuir contrato com status `'suspenso'`.
- **`INICIO_NAO_INFORMADO`:** Ativado para indústrias sem data de início cadastrada e sem contrato ativo/suspenso.
- **`ELEGIVEL`:** Ativado para pares que possuem apenas contratos históricos com status `'encerrado'` e data de início de operação informada, liberando a nova contratação.

---

## 4. Resultados da Validação

- `npx tsx --test src/lib/contratosService.test.ts`:
  ```text
  # tests 81
  # suites 22
  # pass 81
  # fail 0
  # duration_ms 495ms
  ```
- `npm run lint`: **0 erros** (`tsc --noEmit`).
- `npm run build`: **Sucesso completo** no build do Vite.
- `git status -s`: Sem arquivos no stage ou commits criados.

---

## 5. Arquivos Modificados
- [contratosService.ts](file:///c:/projetos/mk9-data/src/lib/contratosService.ts): Exportação da função pura `classificarParContratual()`.
- [IndustriesView.tsx](file:///c:/projetos/mk9-data/src/views/IndustriesView.tsx): Consumo de `classificarParContratual()` no mapeamento de elegíveis.
- [contratosService.test.ts](file:///c:/projetos/mk9-data/src/lib/contratosService.test.ts): Adição de 15 testes de regressão na Seção 8.
- [ETAPA_H3_7_TESTES_REGRESSAO.md](file:///c:/projetos/mk9-data/docs/controle-frequencia/ETAPA_H3_7_TESTES_REGRESSAO.md): Documentação formal dos testes.

---

## 6. Confirmação de Segurança
Nenhuma operação de escrita (`INSERT`, `UPDATE`, `DELETE`), RPC, migration ou chamada ao método `createContrato()` foi executada. O banco remoto permanece 100% intocado.

