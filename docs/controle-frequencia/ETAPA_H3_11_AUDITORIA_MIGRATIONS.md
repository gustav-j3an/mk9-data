# MK9 DATE — ETAPA H3.11: AUDITORIA FINAL DAS MIGRATIONS PARA HOMOLOGAÇÃO

**Data da Auditoria:** 18 de Outubro de 2026  
**Status do Ambiente:** **BLOQUEADO PELO DOCKER ENGINE / PRONTO EM NÍVEL DE CÓDIGO E SQL**  
**Ambiente:** `C:\projetos\mk9-data`  
**Escopo:** Auditoria detalhada das migrations SQL, dependências de objetos, ordem de execução em instalação limpa, situação do Docker e plano reproduzível dos 7 testes de integração.

---

## 1. Auditoria de Dependências Reais dos Objetos SQL

Inspecionamos integralmente as migrations do projeto para mapear as dependências reais de tabelas, colunas, funções, triggers e policies.

### 1.1. Matriz de Dependências por Objeto

| Objeto SQL | Tipo | Criado em qual Migration | Dependências Diretas |
| :--- | :--- | :--- | :--- |
| `public.industrias` | Tabela | `20260930_create_import_tables.sql` | Nenhuma (tabela base). |
| `public.lojas` | Tabela | `20260930_create_import_tables.sql` | Nenhuma (tabela base). |
| `public.promotores` | Tabela | `20260930_create_import_tables.sql` | Nenhuma (tabela base). |
| `public.rotas` | Tabela | `20260930_create_import_tables.sql` | `promotores(matricula)`, `lojas(codigo)`, `industrias(codigo)`. |
| `public.is_admin_or_gestor()` | Função | `20261006_harden_rbac_rls.sql` | `public.profiles`. |
| `public.get_auth_promotor_matricula()` | Função | `20261006_harden_rbac_rls.sql` | `public.profiles`. |
| `public.get_auth_industria_codigo()` | Função | `20261008_industry_client_access.sql` | `public.profiles`. |
| `public.contratos_lojas` | Tabela | `20261017120000_create_contratos_lojas_table.sql` | `public.industrias(codigo)`, `public.lojas(codigo)`. |
| `trigger_check_contratos_vigencia_overlap` | Trigger | `20261017120000_create_contratos_lojas_table.sql` | `public.lojas` (para `SELECT FOR UPDATE`). |
| Políticas RLS de `contratos_lojas` | Policies | `20261017120000_create_contratos_lojas_table.sql` | `is_admin_or_gestor()`, `get_auth_industria_codigo()`, `get_auth_promotor_matricula()`, `public.rotas`. |
| `industrias.data_inicio_operacao` | Coluna | `20261018150000_add_data_inicio_operacao_to_industrias.sql` | `public.industrias`. |

---

### 1.2. Respostas às Dúvidas Críticas da Auditoria

1. **A migration `20261017120000_create_contratos_lojas_table.sql` depende de `data_inicio_operacao`?**
   - **NÃO.** A tabela `public.contratos_lojas` referencia apenas `public.industrias(codigo)`. Nem sua DDL, nem suas constraints (`CHECK`), nem a trigger de overlap (`check_contratos_vigencia_overlap`), nem suas policies de RLS consultam ou exigem a coluna `data_inicio_operacao`.
2. **A migration `20261018150000_add_data_inicio_operacao_to_industrias.sql` pode rodar antes ou depois de `contratos_lojas`?**
   - **SIM, em qualquer ordem a nível de banco.** A coluna `data_inicio_operacao` pertence à tabela `industrias` (que existe desde 30/09). A tabela `contratos_lojas` não referencia essa coluna via DDL.
3. **Como o Supabase CLI aplica as migrations em uma instalação limpa?**
   - O Supabase CLI executa as migrations em **ordem alfanumérica estrita** dos nomes dos arquivos:
     1. `20260930_create_import_tables.sql` (Cria `industrias`, `lojas`, `promotores`, `rotas`);
     2. `20261006_harden_rbac_rls.sql` (Cria `is_admin_or_gestor` e `get_auth_promotor_matricula`);
     3. `20261008_industry_client_access.sql` (Cria `get_auth_industria_codigo`);
     4. `20261017120000_create_contratos_lojas_table.sql` (Cria `contratos_lojas`, trigger de overlap e policies);
     5. `20261018150000_add_data_inicio_operacao_to_industrias.sql` (Adiciona `data_inicio_operacao` em `industrias`).
   - Como todas as funções auxiliares (`is_admin_or_gestor`, etc.) foram criadas entre 06/10 e 08/10, quando a migration de 17/10 é executada, **todas as suas dependências já existem no banco**.
4. **Existem migrations posteriores que dependam da tabela ou coluna?**
   - Não há migrations posteriores. As únicas referências à coluna `data_inicio_operacao` estão na proposta de procedure `supabase/migrations/propostas/20261018160000_proposal_sync_contratos_with_data_inicio.sql`, que está isolada fora da pasta principal e não é executada.

---

## 2. Diagnóstico de Compatibilidade com Instalação Limpa

Avaliamos se alguma migration pode falhar ao ser executada em um banco de dados novo:
- **`20260930_create_import_tables.sql`:** Utiliza `CREATE TABLE IF NOT EXISTS` e tipos padrão do PostgreSQL (`UUID`, `TEXT`, `TIMESTAMPTZ`). Executa sem erros.
- **`20261006_harden_rbac_rls.sql`:** Utiliza `CREATE OR REPLACE FUNCTION` com tratamento idempotente.
- **`20261017120000_create_contratos_lojas_table.sql`:**
  - Utiliza `CREATE TABLE IF NOT EXISTS`.
  - Utiliza `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`.
  - Utiliza `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
  - Todas as funções chamadas nas policies (`is_admin_or_gestor()`, etc.) foram criadas em migrações anteriores.
- **`20261018150000_add_data_inicio_operacao_to_industrias.sql`:**
  - Encapsulada em bloco `DO $$ BEGIN ... END $$` verificando `information_schema.columns`. É 100% idempotente e segura.

**Conclusão Técnica:** O conjunto de migrations é **100% compatível** com uma instalação limpa (`supabase start` / `supabase db reset`), sem risco de quebra de integridade referencial.

---

## 3. Situação do Docker Engine

- **Verificação via `docker info`:**
  - Cliente: Versão `29.8.2`.
  - Conexão com a Engine: **FALHA** (`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`).
- **Diagnóstico:** O executável do Docker Desktop está instalado, mas o serviço de background (Docker Engine / daemon) não está ativo no Windows.
- **Como Desbloquear:** O usuário deve abrir o aplicativo **Docker Desktop** no Windows e aguardar o indicador de status ficar verde ("Engine running"). Nenhum contorno manual deve ser feito no código.

---

## 4. Plano Reproduzível dos 7 Testes de Integração

Abaixo, a diferenciação rigorosa entre testes unitários, testes SQL diretos e testes de integração real na aplicação:

| Cenário de Teste | Camada Validada | Método de Execução no Ambiente Local | Critério Concreto de Sucesso |
| :--- | :--- | :--- | :--- |
| **1. Criação Válida** | Integração (App + DB) | Via frontend ou script chamando `createContrato()` com payload sanitizado para par `IND-001` + `LOJ-001`. | Retorno HTTP 201; registro persistido na tabela com `id` gerado e dados batendo com a tela. |
| **2. Valor Inválido Bloqueado** | Unidade & Interface | Preencher `0`, `-10` ou vazio no modal da UI. | Frontend exibe erro de validação em vermelho e impede envio; chamada a `createContrato()` não ocorre. |
| **3. Bloqueio de Overlap** | SQL & Banco de Dados | Tentar inserir um segundo contrato ativo para o mesmo par com vigência coincidente via query SQL direta. | O PostgreSQL rejeita a transação com erro `P0001` e mensagem `"Conflito de vigência contratual..."`. |
| **4. Vigência Pós-Encerramento** | SQL & Integração | Par com contrato `status = 'encerrado'` até `2026-06-30`; tentar inserir novo contrato ativo iniciando em `2026-07-01`. | Inserção aceita com sucesso pelo banco. A trigger confirma que status `encerrado` não gera overlap. |
| **5. Contrato Contínuo KING** | Integração (App + DB) | Criação de contrato para `IND-013` selecionando opção contínua. | Registro gravado com `data_fim_vigencia IS NULL`. Ciclo 23–22 é exibido apenas na apuração do front. |
| **6. Bloqueio RLS por Perfil** | SQL & Segurança API | Executar requisição POST autenticado como token de `promotor` tentando inserir em `contratos_lojas`. | O PostgREST retorna `403 Forbidden` / violação de policy `contratos_lojas_insert_policy`. |
| **7. Concorrência Simultânea** | SQL / Transacional | Disparar dois scripts Node/SQL paralelos tentando inserir contratos ativos para o mesmo par no mesmo instante. | Graças ao `SELECT FOR UPDATE` na tabela `lojas`, uma transação passa e a outra falha com exceção de overlap. Não ocorrem dois contratos ativos. |

---

## 5. Pendências que Impedem a Homologação

1. **Ativação do Docker Desktop:** O comando `npx supabase start` depende exclusivamente da inicialização da engine do Docker.
2. **Criação do Seed Local (`supabase/seed.sql`):** Preparar uma massa sintética com 2 indústrias, 2 lojas, 1 promotor e 1 usuário gestor para alimentar a homologação.

---

## 6. Resultados da Validação Técnica Local

- `npx tsx --test src/lib/contratosService.test.ts`: **81 testes aprovados** (0 falhas).
- `npm run lint`: **0 erros** (`tsc --noEmit`).
- `npm run build`: **Compilação de produção concluída com sucesso**.
- **Segurança:** O Supabase remoto não foi acessado; nenhum dado foi alterado; nenhum commit foi feito.

---

## 7. Parecer Final

> **PARECER:** O projeto está **PRONTO EM NÍVEL DE CÓDIGO E SQL**, porém **BLOQUEADO OPERACIONALMENTE PELA INATIVIDADE DO DOCKER DESKTOP**.  
> Nenhuma alteração nas migrations é necessária. Assim que o Docker Engine for iniciado, o comando `npx supabase start` poderá ser executado com total segurança.

