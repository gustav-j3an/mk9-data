# MK9 Data — Etapa H3.15: Aplicação Controlada de Migrations no Supabase Local

**Data:** 18 de Outubro de 2026  
**Status:** Concluído com Sucesso  
**Ambiente:** PostgreSQL Local Docker (`supabase_db_mk9-data` em `127.0.0.1:54322`)  
**Escopo:** Aplicação controlada e cirúrgica das duas migrations de contratos com preservação integral de dados, registro de schema_migrations e auditoria estrutural.

---

## 1. Pré-Verificações e Diagnóstico Inicial

### 1.1 Estado do Container e Conexão
- **Container verificado:** `supabase_db_mk9-data` (Status: `Up (healthy)`, mapeado para `127.0.0.1:54322`).
- **Conexão local estrita:** Verificada via `inet_server_addr()` e `current_database()` retornando o banco local `postgres` no usuário `postgres`.
- **Zero contato com nuvem:** Nenhuma chamada foi efetuada a endpoints remotos ou projeto Supabase em produção.

### 1.2 Estado Inicial das Tabelas e Schema Migrations
- **Tabela de controle:** `supabase_migrations.schema_migrations` não existia inicialmente (o banco local anterior havia sido inicializado antes do tracking do CLI).
- **Contagem prévia de registros preservados:**
  - `industrias`: 1 registro (`IND-001` - Indústria Teste Manual Atualizada Ltda)
  - `profiles`: 1 registro (`admin.homolog@mk9.local`)
  - `lojas`, `rotas`, `promotores`, `visits`: 0 registros
  - `contratos_lojas`: Não existia
  - `industrias.data_inicio_operacao`: Não existia

### 1.3 Backup de Segurança Local Executado
Antes de qualquer alteração estrutural, foi gerado um dump completo do banco local:
- **Arquivo:** `supabase/backups/backup_pre_h3_15.sql`
- **Tamanho:** 473.053 bytes
- **Comando utilizado:** `docker exec supabase_db_mk9-data pg_dump -U postgres -d postgres --clean --if-exists`

---

## 2. Metodologia de Aplicação e Justificativa de Segurança

Conforme identificado na auditoria H3.11 e H3.14:
- O arquivo `supabase/config.toml` está configurado com `[db.migrations] enabled = false`.
- O histórico CLI anterior não possuía a tabela `supabase_migrations.schema_migrations`.
- Disparar `supabase db reset` apagaria as tabelas existentes (`industrias`, `profiles`, etc.) e os 16 schemas operacionais.
- Disparar `supabase db push` ou `supabase link` ofereceria risco inaceitável de tentar sincronizar com produção.

**Estratégia adotada:**
1. Inicialização segura da tabela de controle `supabase_migrations.schema_migrations`.
2. Aplicação das migrations em lote ordenado via `psql` direto no container local com a flag `-v ON_ERROR_STOP=1`.
3. Ordem de dependência validada:
   - **1º:** `20261018150000_add_data_inicio_operacao_to_industrias.sql` (adiciona coluna `data_inicio_operacao DATE NULL`).
   - **2º:** `20261017120000_create_contratos_lojas_table.sql` (cria tabela `contratos_lojas`, índices, trigger de sobreposição temporal, trigger de `updated_at`, policies RLS e procedure de sincronização).
4. Registro atômico e formal das versões aplicadas em `supabase_migrations.schema_migrations`.

---

## 3. Execução das Migrations

### 3.1 Migration 1: `20261018150000_add_data_inicio_operacao_to_industrias.sql`
- **Resultado:** Executado com sucesso (`DO`).
- **Registro:** Version `20261018150000`, Name `add_data_inicio_operacao_to_industrias`.

### 3.2 Migration 2: `20261017120000_create_contratos_lojas_table.sql`
- **Resultado:** Executado com sucesso:
  - Tabela `public.contratos_lojas` criada.
  - Índices `idx_contratos_industria`, `idx_contratos_loja`, `idx_contratos_status_vigencia` criados.
  - Funções `check_contratos_vigencia_overlap()`, `handle_contratos_updated_at()` e `sync_contratos_from_rotas()` criadas.
  - Triggers `trigger_check_contratos_vigencia_overlap` e `trigger_contratos_updated_at` criadas.
  - RLS ativado com as 4 políticas: `contratos_lojas_select_policy`, `contratos_lojas_insert_policy`, `contratos_lojas_update_policy` e `contratos_lojas_delete_policy`.
  - Permissões de execução revogadas de `PUBLIC` e concedidas com menor privilégio a `authenticated`.
- **Registro:** Version `20261017120000`, Name `create_contratos_lojas_table`.

---

## 4. Auditoria e Validação Pós-Aplicação

### 4.1 Coluna `industrias.data_inicio_operacao`
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'industrias' AND column_name = 'data_inicio_operacao';
```
- **Resultado:** `data_inicio_operacao | date | YES` (Confirmado).

### 4.2 Tabela `public.contratos_lojas`
- **21 colunas criadas e validadas:**
  - `id` (uuid, PK, gen_random_uuid())
  - `industria_codigo` (text, NOT NULL, FK industrias)
  - `loja_codigo` (text, NOT NULL, FK lojas)
  - `frequencia` (text, NOT NULL, default 'SEMANAL')
  - `visitas_por_semana` (integer, NULL)
  - `segunda` a `domingo` (boolean, NOT NULL, default false)
  - `ciclo_quinzenal` (text, NULL)
  - `data_inicio_vigencia` (date, NOT NULL, default CURRENT_DATE)
  - `data_fim_vigencia` (date, NULL)
  - `status` (text, NOT NULL, default 'ativo')
  - `valor_por_visita` (numeric(10,2), NULL)
  - `origem` (text, default 'manual')
  - `observacao` (text)
  - `created_at` / `updated_at` (timestamptz)

### 4.3 Constraints Verificadas
- `check_vigencia_valida`: `(data_fim_vigencia IS NULL) OR (data_fim_vigencia >= data_inicio_vigencia)`
- `contratos_lojas_check`: Validação estrita de `visitas_por_semana` (obrigatório 1..7 se SEMANAL; nulo se QUINZENAL ou MENSAL)
- `contratos_lojas_check1`: Validação estrita de `ciclo_quinzenal` (obrigatório e enum válido se QUINZENAL; nulo caso contrário)
- `contratos_lojas_frequencia_check`: `SEMANAL`, `QUINZENAL`, `MENSAL`
- `contratos_lojas_status_check`: `ativo`, `inativo`, `suspenso`, `encerrado`
- `contratos_lojas_valor_por_visita_check`: `valor_por_visita IS NULL OR valor_por_visita >= 0`
- `contratos_lojas_industria_codigo_fkey`: FK para `industrias(codigo)` ON UPDATE CASCADE ON DELETE RESTRICT
- `contratos_lojas_loja_codigo_fkey`: FK para `lojas(codigo)` ON UPDATE CASCADE ON DELETE RESTRICT

### 4.4 Triggers e RLS Verificados
- `trigger_check_contratos_vigencia_overlap`: Ativa (BEFORE INSERT OR UPDATE) com lock pessimista em `lojas` e bloqueio de sobreposições para status `ativo` e `suspenso`.
- `trigger_contratos_updated_at`: Ativa (BEFORE UPDATE).
- **Políticas RLS:**
  - `contratos_lojas_select_policy` (SELECT para admin, gestor, operador, própria indústria ou promotor com rota)
  - `contratos_lojas_insert_policy` (INSERT restrito a admin, gestor, operador)
  - `contratos_lojas_update_policy` (UPDATE restrito a admin, gestor, operador)
  - `contratos_lojas_delete_policy` (DELETE exclusivo para admin)

### 4.5 Integridade dos Dados Preexistentes
Contagem de linhas após a migração:
- `industrias`: 1 (Registro `IND-001` intacto)
- `profiles`: 1 (Registro de admin intacto)
- `contratos_lojas`: 0 (Nenhum contrato criado antecipadamente)
- `rotas`, `lojas`, `visits`: 0 (Intactos)

### 4.6 Tabela de Migrations Registradas
```sql
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;
```
| version | name |
| :--- | :--- |
| `20261017120000` | `create_contratos_lojas_table` |
| `20261018150000` | `add_data_inicio_operacao_to_industrias` |

---

## 5. Verificação da Aplicação e Regressão

- **Testes Unitários:** 81/81 testes passaram com 100% de sucesso (`contratosService.test.ts`).
- **TypeScript Lint:** 0 erros (`tsc --noEmit`).
- **Restrições de Segurança Respeitadas:**
  - Nenhum contrato real ou fictício foi inserido.
  - A procedure `sync_contratos_from_rotas()` **não foi executada**.
  - O código da aplicação não foi modificado.
  - Nenhum commit foi realizado no Git.

---

## 6. Conclusão e Parecer de Prontidão

As duas migrations foram aplicadas com sucesso e com segurança absoluta no banco local isolado do Docker.  
O schema local do PostgreSQL está íntegro, com todas as constraints, triggers, funções de concorrência e políticas de RLS prontas para a execução dos testes de integração sintéticos na próxima etapa.

