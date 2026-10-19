# MK9 Data — Etapa H3.16: Testes de Integração Controlados de Contratos

**Data:** 18 de Outubro de 2026  
**Status:** Concluído com Sucesso — Todos os 10 cenários mínimos validados  
**Ambiente:** PostgreSQL Local Docker (`supabase_db_mk9-data` em `127.0.0.1:54322`)  
**Escopo:** Testes de integração diretos no banco local sobre a tabela `contratos_lojas`, validação de constraints, triggers de sobreposição, RLS granular e limpeza estrita.

---

## 1. Pré-Verificações e Diagnóstico do Ambiente

1. **Relatório da Etapa Anterior:** `docs/controle-frequencia/ETAPA_H3_15_APLICACAO_LOCAL.md` inspecionado e confirmado.
2. **Container e Conexão Local:**
   - Container `supabase_db_mk9-data`: Ativo e saudável (`Up (healthy)`).
   - Porta local: `127.0.0.1:54322`.
   - Conexão estritamente local: Sem contato remoto com produção.
3. **Backup de Segurança Verificado:**
   - Arquivo `supabase/backups/backup_pre_h3_15.sql` confirmado intacto com 473.053 bytes.
4. **Análise de Incompatibilidade Futura com Supabase CLI:**
   - Como identificado no H3.14/H3.15, o `config.toml` possui `[db.migrations] enabled = false`.
   - A tabela `supabase_migrations.schema_migrations` foi inicializada e populada com `20261017120000` e `20261018150000`.
   - **Risco mapeado:** Caso o usuário reative `enabled = true` no futuro sem sincronizar o histórico prévio completo (migrations anteriores de auth/tabelas base), o CLI poderia tentar reexecutar migrations anteriores e falhar por objetos já existentes (`already exists`). Para migrações futuras, recomenda-se manter o histórico alinhado via `supabase migration repair` caso o CLI seja utilizado.

---

## 2. Isolamento, Fixtures Sintéticas e Limpeza

- **Premissa de Isolamento:** Nenhuma indústria, loja ou usuário existente em produção ou no banco local preexistente foi modificado.
- **Fixtures Sintéticas Utilizadas (Transitórias):**
  - Indústrias: `IND-TEST-001`, `IND-TEST-002`
  - Loja: `LOJA-TEST-001`
  - Usuários/Perfis: IDs sintéticos `22222222-...`, `33333333-...`, `44444444-...`
- **Mecanismo de Limpeza:**
  - Todos os cenários de teste foram executados dentro de blocos transacionais controlados finalizados com `ROLLBACK`.
  - **Verificação pós-testes:**
    - `public.contratos_lojas`: 0 registros.
    - `public.industrias`: 1 registro (`IND-001` preexistente intacto).
    - `public.profiles`: 1 registro (`admin.homolog@mk9.local` preexistente intacto).
    - `public.lojas`, `rotas`, `promotores`, `visits`: 0 registros (intactos).

---

## 3. Matriz de Cenários e Resultados

| # | Cenário Testado | Mecanismo Validado | Resultado | Status |
|---|-----------------|-------------------|-----------|:------:|
| 1 | Inserção de contrato válido | `INSERT` com vigência contínua, frequência SEMANAL, 1 visita e valor decimal | Inserido com sucesso | **APROVADO** |
| 2 | Rejeição de valor por visita inválido | `CHECK (valor_por_visita IS NULL OR valor_por_visita >= 0)` | Rejeitado com erro `violates check constraint "contratos_lojas_valor_por_visita_check"` ao tentar `-50.00` | **APROVADO** |
| 3 | Rejeição de data final anterior à inicial | `CHECK (data_fim_vigencia IS NULL OR data_fim_vigencia >= data_inicio_vigencia)` | Rejeitado com erro `violates check constraint "check_vigencia_valida"` | **APROVADO** |
| 4 | Rejeição de frequência inválida | `CHECK (frequencia IN ('SEMANAL', 'QUINZENAL', 'MENSAL'))` | Rejeitado com violação da constraint ao tentar `'DIARIA'` | **APROVADO** |
| 5 | Rejeição de vigências conflitantes para mesma loja/indústria | Trigger `trigger_check_contratos_vigencia_overlap` com Lock Pessimista | Bloqueado com exceção: `Conflito de vigência contratual: já existe contrato ativo ou suspenso` | **APROVADO** |
| 6 | Aceitação de vigências não sobrepostas | Trigger `trigger_check_contratos_vigencia_overlap` | Aceitou dois contratos consecutivos (`2026-01-01 a 2026-06-30` e `2026-07-01 a 2026-12-31`) | **APROVADO** |
| 7 | Contratos históricos encerrados não bloqueiam novas vigências | Condição `status IN ('ativo', 'suspenso')` no trigger | Contrato com status `'encerrado'` permitiu inserção simultânea de novo contrato `'ativo'` cobrindo o mesmo período | **APROVADO** |
| 8 | Atualização automática de `updated_at` | Trigger `trigger_contratos_updated_at` BEFORE UPDATE | `updated_at` atualizado automaticamente para `NOW()` após `UPDATE` | **APROVADO** |
| 9 | Verificação de RLS por papel e operação | Policies `contratos_lojas_select_policy` e `contratos_lojas_delete_policy` | - Admin: Leitura e Delete permitidos<br>- Cliente indústria: Enxerga apenas contratos da sua própria indústria (`IND-TEST-001`), bloqueando de outra<br>- Operador: Delete físico bloqueado (0 rows deletadas) | **APROVADO** |
| 10 | Validação de `data_inicio_operacao` e regra especial KING | Schema SQL vs Lógica da Aplicação | - No banco: `data_inicio_operacao` é coluna comercial neutra (`DATE NULL`)<br>- Regra KING (ciclo 23 a 22): Confirmado que **NÃO** existe trigger/procedure em SQL para a regra KING (ela é implementada na camada TypeScript da aplicação em `contratosService.ts`). Não houve presunção incorreta de automação SQL. | **APROVADO** |

---

## 4. Detalhamento Técnico das Evidências

### 4.1 Cenário 5: Bloqueio Estrito de Sobreposição
```text
ERROR:  Conflito de vigência contratual: já existe contrato ativo ou suspenso (ID 70a0b789-a2ba-404f-b2fa-0f6294a245c8) para a indústria IND-TEST-001 e loja LOJA-TEST-001 no período informado.
CONTEXT:  PL/pgSQL function check_contratos_vigencia_overlap() line 41 at RAISE
```

### 4.2 Cenário 7: Não-bloqueio por Contratos Encerrados
```text
                  id                  | data_inicio_vigencia | data_fim_vigencia |  status   | valor_por_visita 
--------------------------------------+----------------------+-------------------+-----------+------------------
 47e404a2-e366-408f-ab49-e964c15c06c7 | 2026-01-01           | 2026-12-31        | encerrado |           100.00
 1e6d716d-e4ed-4b13-8c89-d3be51a1d6a2 | 2026-06-01           |                   | ativo     |           150.00
(2 rows)
```

### 4.3 Cenário 9: RLS Multi-Tenant e Permissões de Exclusão
```text
       scenario       | count 
----------------------+-------
 TESTE_1_ADMIN_SELECT |     1

              scenario              | count 
------------------------------------+-------
 TESTE_2_CLIENTE_PROPRIA_IND_SELECT |     1

           scenario           | count 
------------------------------+-------
 TESTE_3_OUTRO_CLIENTE_SELECT |     0

           scenario            | count 
-------------------------------+-------
 TESTE_4_AFTER_OPERADOR_DELETE |     1  (Delete barrado pelo RLS!)

          scenario          | count 
----------------------------+-------
 TESTE_5_AFTER_ADMIN_DELETE |     0  (Delete executado pelo Admin!)
```

---

## 5. Validação da Aplicação e Regressão

- **Testes Unitários:** `npx tsx --test src/lib/contratosService.test.ts`
  - **81 testes aprovados** (0 falhas em 22 suites).
- **TypeScript Lint:** `npm run lint` (`tsc --noEmit`)
  - **0 erros**.
- **Build de Produção:** `npm run build` (Vite v8.3.1)
  - **100% aprovado** em 744ms.
- **Git Status:** Working tree limpa de alterações não autorizadas; nenhum commit realizado.

---

## 6. Limitações e Riscos Pendentes

1. **Regra KING no Banco:**
   - A regra de apuração do ciclo 23-22 da indústria KING (`IND-013`) reside intencionalmente na camada de serviço (`src/lib/contratosService.ts`). Não há constraint de calendário no PostgreSQL limitando datas específicas para a KING.
2. **Procedure `sync_contratos_from_rotas()`:**
   - Preservada conforme especificação de segurança; não foi executada para evitar criação prematura em massa de contratos.
3. **Persistência do Front-End:**
   - O modal de revisão na interface continua em modo de prévia/simulação até a autorização explícita para ativação da persistência real.

---

## 7. Conclusão Objetiva

A integridade do modelo contratual foi **plenamente comprovada no PostgreSQL local**:
- As constraints impedem dados inválidos (valores negativos, frequências inexistentes e datas invertidas).
- A trigger de sobreposição impede double-booking para a mesma loja/indústria, liberando contratos encerrados.
- O RLS protege o isolamento multi-tenant de clientes e impede exclusões por operadores.
- A base local permanece limpa e íntegra.

