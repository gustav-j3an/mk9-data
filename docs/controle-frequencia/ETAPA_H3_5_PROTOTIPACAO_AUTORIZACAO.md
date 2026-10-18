# MK9 DATE — ETAPA H3.5: PLANEJAMENTO E PROTOTIPAÇÃO DA AUTORIZAÇÃO INDIVIDUAL DE CONTRATOS

**Data:** 18 de Outubro de 2026  
**Status:** IMPLEMENTADO E VALIDADO (MODO PROTÓTIPO / SEM GRAVAÇÃO REMOTA OU LOCAL)  
**Ambiente:** `C:\projetos\mk9-data`  
**Escopo:** `src/views/IndustriesView.tsx`, `src/lib/contratosService.ts`, `src/types.ts`

---

## 1. Resumo Executivo da Etapa H3.5

Nesta etapa, foi planejado e prototipado o fluxo de **revisão e autorização individual de contratos** diretamente a partir da aba **Prévia de Contratos** em [IndustriesView.tsx](file:///c:/projetos/mk9-data/src/views/IndustriesView.tsx).

O objetivo central foi conferir ao gestor a capacidade de inspecionar individualmente uma combinação elegível de indústria e loja, definindo os parâmetros comerciais obrigatórios que não existem no módulo de rotas (especialmente o **valor monetário por visita** e a **data de encerramento da vigência**), simulando a validação das regras contratuais através da função pura `prepareContratoInsertData()` **sem realizar qualquer gravação no Supabase**.

---

## 2. Detalhamento da Implementação

### 2.1. Controle de Acesso e Exibição Condicional
- O botão **Revisar** e a coluna de ações são visíveis **exclusivamente** para usuários com perfil `admin` ou `gestor` (`canEdit = hasPermission(['admin', 'gestor'])`).
- Para combinações que não estão na situação `ELEGIVEL` (por exemplo: pares com `JA_POSSUI_ATIVO`, `JA_POSSUI_SUSPENSO`, `INICIO_NAO_INFORMADO` ou `ERRO_CONSULTA`), o botão de ação fica desativado e substituído pelo indicador visual `Bloqueado` com tooltip explicativo. Pares com conflito de frequência permanecem isolados na Tabela 2 e bloqueados para revisão.

### 2.2. Modal de Revisão e Autorização Individual
Ao clicar em **Revisar**, abre-se o modal contendo:
1. **Identificação Completa:** Indústria (nome e código) e Loja/PDV (nome, código, cidade e UF).
2. **Destaque para KING (`IND-013`):** Indicador visual destacando a vigência contínua e o ciclo de apuração comercial do dia 23 ao dia 22.
3. **Frequência e Dias de Visita:** Badge com a frequência operacional (`SEMANAL`, `QUINZENAL`, `MENSAL`), contagem de visitas por semana e chips visuais dos 7 dias da semana indicando onde há visitas ativas.
4. **Data de Início da Operação:** Exibição da data cadastrada na indústria ou indicação de que o contrato seguirá a referência.
5. **Período de Apuração Calculado:** Projeção de datas (`data_inicio` a `data_fim`), competência (`YYYY-MM`) e tipo de ciclo (`MENSAL_PADRAO`, `PRIMEIRA_VIGENCIA_PRO_RATA` ou `ESPECIAL_KING_23_22`).
6. **Campo Obrigatório de Valor por Visita:** Preenchimento mandatório em R$, validando formato numérico estrito maior que zero. O sistema **não infere** nem inventa valores, pois rotas não possuem dados financeiros.
7. **Opção de Vigência Comercial:**
   - **Contrato Contínuo (Padrão):** `data_fim_vigencia = NULL`, por prazo indeterminado (obrigatório para a KING).
   - **Prazo Determinado:** Exibe campo de data final da vigência comercial com validação estrita de calendário (`parseISODate`) e coerência temporal (data final deve ser maior ou igual à data de início).
8. **Campo de Observações:** Anotações comerciais opcionais.
9. **Simulação e Prévia do Payload:** Botão **Validar e Simular Contrato** que aciona `prepareContratoInsertData()`, validando a estrutura do objeto e apresentando o JSON sanitizado pronto para o Supabase, acompanhado de aviso explícito de que nenhum dado foi gravado.

---

## 3. Validações e Regras de Negócio Aplicadas

| Regra / Validação | Como foi Tratada |
| :--- | :--- |
| **Valor por Visita** | Obrigatório, numérico, > 0. Rejeita nulos, negativos ou strings inválidas. |
| **Vigência Contínua vs Determinada** | Opção explícita no formulário. Contínuo define `data_fim_vigencia = null`. |
| **Coerência Temporal de Vigência** | Rejeita `data_fim_vigencia < data_inicio_vigencia`. Valida formato ISO YYYY-MM-DD. |
| **Ciclo KING (`IND-013`)** | Preserva ciclo 23 a 22 no cálculo do período, mantendo vigência comercial contínua sem quebra mensal. |
| **Demais Indústrias** | Utiliza `data_inicio_operacao` como início da vigência e primeiro período pro-rata até o fim do mês. |
| **Bloqueios Preventivos** | Impossível abrir revisão para pares com contrato ativo/suspenso, conflito ou início ausente. |
| **Isolamento de Persistência** | Não há chamadas a `supabase.from('contratos_lojas').insert()` ou `createContrato()`. |

---

## 4. Verificação Técnica e Testes

- **Testes Unitários:** `npx tsx --test src/lib/contratosService.test.ts`
  - Resultado: **66 testes aprovados** (0 falhas).
- **TypeScript / Linter:** `npm run lint` (`tsc --noEmit`)
  - Resultado: **0 erros** de tipo ou sintaxe.
- **Build de Produção:** `npm run build` (`vite build`)
  - Resultado: **Compilação concluída com sucesso**.
- **Git:** Nenhuma alteração adicionada ao stage ou commitada.

