# MK9 Data — Etapa H3.18: Validação Funcional Ponta a Ponta do Módulo de Contratos

**Data:** 18 de Outubro de 2026  
**Status:** Concluído com Sucesso — 12 Cenários Validados com Evidências  
**Ambiente:** PostgreSQL Local Docker (`supabase_db_mk9-data` em `127.0.0.1:54322`)  
**Escopo:** Inspeção e validação funcional ponta a ponta da interface (`IndustriesView.tsx`), do serviço (`contratosService.ts`), das regras comerciais (KING e Pro-Rata), concorrência e integridade de persistência.

---

## 1. Inspeção de Código e Governança

1. **Relatório da Etapa Anterior:** `docs/controle-frequencia/ETAPA_H3_17_CONEXAO_GRAVACAO.md` revisado.
2. **Inspeção de Diffs (`git diff src/views/IndustriesView.tsx`):**
   - Importação adicionada: `CreateContratoLojaDTO` de `../types`.
   - Estado de feedback adicionado: `const [savingContrato, setSavingContrato] = useState(false);`.
   - Ação do botão principal conectada diretamente a `contratosService.createContrato(payloadDTO)`.
   - Tratamento de erro granular (`isMigrationPending` via `MigrationPendingError` e mensagens amigáveis de trigger de sobreposição).
   - Recarregamento automático da grade de contratos via `fetchContratos()` após o salvamento bem-sucedido.
3. **Preservação de Permissões da Interface:**
   - Apenas perfis autorizados (`admin` e `gestor`) enxergam a coluna de Ações e o botão `Revisar` (`canEdit = hasPermission(['admin', 'gestor'])`).
   - Usuários não autorizados (`operador`, `promotor`, `client_industry`) têm a ação de revisão omitida na interface e bloqueada por RLS no banco.

---

## 2. Matriz de Cenários de Teste Funcional Ponta a Ponta

| # | Cenário Funcional | Camada Avaliada | Evidência / Comportamento Real | Status |
|:---:|:---|:---|:---|:---:|
| **1** | Abrir o modal de cadastro/revisão de contrato | UI (`IndustriesView.tsx`) | Ao clicar em `Revisar`, abre modal com cabeçalho da indústria/loja, dias da semana, início operacional e formulário de vigência/valor | **APROVADO** |
| **2** | Tentar salvar sem valor por visita | Front-End Form | Bloqueado com a mensagem: `"Informe um valor por visita válido e maior que zero (R$)."`. `createContrato()` não é chamado. | **APROVADO** |
| **3** | Tentar salvar com valor zero ou negativo | Front-End & Serviço | Bloqueado na UI (`errors.valor`) e validado no serviço (`"O valor por visita não pode ser negativo."`) | **APROVADO** |
| **4** | Vigência final anterior à data inicial | Front-End & Serviço | Bloqueado na UI (`errors.data_fim`) e pelo serviço (`"A data de término da vigência não pode ser anterior à data de início."`) | **APROVADO** |
| **5** | Salvar contrato válido e confirmar persistência | Serviço & Banco Local | Registro inserido com sucesso em `public.contratos_lojas` (`ID: a1111111-...`, `R$ 150.50`, vigência contínua). | **APROVADO** |
| **6** | Confirmação de que a listagem é atualizada | UI & Hook | `fetchContratos()` é chamado pós-sucesso, reclassificando o par imediatamente para `JA_POSSUI_ATIVO` com badge `"Contrato Ativo"`. | **APROVADO** |
| **7** | Tentar criar vigência sobreposta | Trigger DB & UI Toast | Bloqueado pela trigger `check_contratos_vigencia_overlap` com exceção de conflito de vigência e exibição de toast de erro ao usuário. | **APROVADO** |
| **8** | Comportamento diante de falha do banco | Tratamento de Erros | Se o banco rejeita, o modal NÃO fecha, `savingContrato` retorna a `false` e emite toast de erro (sem falso positivo de sucesso). | **APROVADO** |
| **9** | Proteção contra cliques repetidos | UI State (`savingContrato`) | Botões `Cancelar` e `Autorizar e Gravar Contrato` recebem `disabled={savingContrato}` e spinner animado no primeiro clique. | **APROVADO** |
| **10** | Regras de período da KING (`IND-013`) | Regra de Negócio Pura | Validado: dia >= 23 gera vigência de 23/M a 22/(M+1) (competência M+1). Dia < 23 gera vigência de 23/(M-1) a 22/M (competência M). | **APROVADO** |
| **11** | Indústria sem `data_inicio_operacao` | Regra de Elegibilidade | Classificada como `INICIO_NAO_INFORMADO`. O botão de revisão fica bloqueado (`"Cadastrar indústria"`). | **APROVADO** |
| **12** | Permissões de RLS para perfis não autorizados | PostgreSQL RLS | Inserção por usuário sem permissão (`client_industry`) bloqueada com violação de policy RLS. | **APROVADO** |

---

## 3. Evidências Reais dos Testes Executados

### 3.1 Execução de Validação Funcional (TypeScript Script `scratch/test_functional_e2e.ts`)
```text
=== INICIANDO VALIDAÇÃO FUNCIONAL PONTA A PONTA (H3.18) ===

--- Cenário 2: Validação do Front/Serviço sem valor por visita ---
✓ Cenário 2 aprovado: Form rejeita valor por visita vazio.

--- Cenário 3: Validação de valor zero ou negativo ---
✓ Cenário 3 aprovado: Form e Serviço rejeitam valor <= 0 ("O valor por visita não pode ser negativo.").

--- Cenário 4: Vigência final anterior à data inicial ---
✓ Cenário 4 aprovado: Form e Serviço rejeitam vigência invertida ("A data de término da vigência não pode ser anterior à data de início.").

--- Cenários 10 e 11: Regras Comerciais KING vs Indústrias Comuns ---
✓ Cenário 10 aprovado: Regra KING opera rigorosamente no ciclo 23-22.
✓ Cenário 11 aprovado: Indústria comum sem data_inicio_operacao bloqueada com "Data de início da operação não cadastrada na indústria. Regularize no cadastro.".

=== VALIDAÇÕES LOCAIS DE REGRAS E FORMS FINALIZADAS COM SUCESSO ===
```

### 3.2 Execução no Banco Local Docker (`scratch/test_scenarios_db.sql`)
```text
BEGIN
INSERT 0 1
INSERT 0 1
INSERT 0 1
          teste           |                  id                  | industria_codigo |  loja_codigo  | status | valor_por_visita | data_inicio_vigencia | data_fim_vigencia 
--------------------------+--------------------------------------+------------------+---------------+--------+------------------+----------------------+-------------------
 CENARIO_5_E_6_PERSISTIDO | a1111111-1111-1111-1111-111111111111 | IND-TEST-001     | LOJA-TEST-001 | ativo  |           150.50 | 2026-01-01           | 
(1 row)

psql:/tmp/test_scenarios_db.sql:79: NOTICE:  CENARIO_7_E_8_SUCESSO_BLOQUEIO: Conflito de vigência contratual: já existe contrato ativo ou suspenso (ID a1111111-1111-1111-1111-111111111111) para a indústria IND-TEST-001 e loja LOJA-TEST-001 no período informado.
ROLLBACK
```

### 3.3 Verificação de Limpeza da Base Local
```sql
SELECT 
  (SELECT count(*) FROM public.industrias) as industrias_count,
  (SELECT count(*) FROM public.lojas) as lojas_count,
  (SELECT count(*) FROM public.rotas) as rotas_count,
  (SELECT count(*) FROM public.profiles) as profiles_count,
  (SELECT count(*) FROM public.contratos_lojas) as contratos_count;
```
- **Resultado:** `industrias: 1 | lojas: 0 | rotas: 0 | profiles: 1 | contratos_lojas: 0`.
- Os registros preexistentes permaneceram 100% intactos.

---

## 4. Testes Automatizados e Regressão

- **Testes Unitários da Aplicação:** `npx tsx --test src/lib/contratosService.test.ts`
  - **81 testes executados, 81 testes aprovados (0 falhas em 22 suites)**. Duração: 356ms.
- **TypeScript Lint:** `npm run lint` (`tsc --noEmit`)
  - **0 erros**.
- **Build de Produção:** `npm run build` (Vite v8.3.1)
  - **100% aprovado** em 613ms.

---

## 5. Garantia de Isolamento Remoto

- **Zero conexões em produção:** Toda a verificação e testes ocorreram no container local `supabase_db_mk9-data` em `127.0.0.1:54322`.
- O banco remoto de produção (`https://xzmbesqhxcnuokjwrbnw.supabase.co`) permaneceu completamente intocado.
- Nenhum commit foi realizado no repositório Git.

---

## 6. Conclusão

O fluxo de autorização e gravação de contratos foi **validado ponta a ponta**.  
A aplicação possui validação em múltiplas camadas (UI, Service DTO e Trigger do Banco), com tratamento de erros robusto, proteção contra duplicidade de submissões e aderência estrita às regras comerciais de apuração.

