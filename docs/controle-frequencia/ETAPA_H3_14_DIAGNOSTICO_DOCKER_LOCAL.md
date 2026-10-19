# MK9 Data — Etapa H3.14: Diagnóstico e Preparação do Ambiente Supabase Local com Docker

**Data:** 18 de Outubro de 2026  
**Status:** Concluído com sucesso (Ambiente local ativo e pronto para homologação)  
**Escopo:** Diagnóstico de Docker Engine, containers Supabase locais, esquema do banco local e plano seguro de aplicação de migrations.

---

## 1. Resumo Executivo

O Docker Desktop foi reativado e o ambiente Supabase local do projeto `mk9-data` já se encontra em plena execução na máquina local (WSL2 / Windows).
Nenhuma alteração de esquema, escrita ou deleção de dados foi realizada nesta etapa diagnóstica.
O isolamento em relação ao Supabase de produção foi rigorosamente preservado (portas locais `54321` para API e `54322` para PostgreSQL local).

---

## 2. Diagnóstico Técnico do Docker Engine e Containers

### 2.1 Estado do Docker
- **Comando executado:** `docker info`
- **Status:** Ativo e saudável (`Server Version: 29.8.2`, Kernel `WSL2 6.6.87.2-microsoft-standard-WSL2`).
- **Containers ativos:** 11 containers em execução.

### 2.2 Containers do Supabase Local (`mk9-data`)
Os seguintes containers dedicados ao projeto estão rodando:
- `supabase_db_mk9-data` (PostgreSQL 15 na porta local `127.0.0.1:54322`)
- `supabase_kong_mk9-data` (API Gateway na porta local `127.0.0.1:54321`)
- `supabase_auth_mk9-data` (GoTrue Auth)
- `supabase_studio_mk9-data` (Supabase Studio Web na porta local `127.0.0.1:54323`)
- `supabase_rest_mk9-data` (PostgREST)
- `supabase_realtime_mk9-data`
- `supabase_storage_mk9-data`
- `supabase_meta_mk9-data`
- `supabase_edge_runtime_mk9-data`
- `supabase_vector_mk9-data`
- `supabase_inbucket_mk9-data` (Servidor SMTP local na porta `127.0.0.1:54324`)

---

## 3. Inspeção do Banco de Dados Local Existente

A inspeção direta no container local `supabase_db_mk9-data` (`docker exec ... psql -U postgres -d postgres`) revelou:

1. **Tabelas existentes no schema `public` (16 tabelas):**
   - `agendamento_itens`, `agendamentos`, `disponibilidade_promotores`, `industrias`, `lojas`, `logs_sistema`, `perfis`, `perfil_permissoes`, `permissoes`, `promotores`, `regioes`, `redes`, `rotas`, `rotas_pontos`, `visitas_fotos`, `visits`.
   - **Tabela `contratos_lojas`:** **NÃO EXISTE** ainda no banco local.
   - **Coluna `data_inicio_operacao` em `industrias`:** **NÃO EXISTE** ainda no banco local.

2. **Rastreamento de migrations do Supabase CLI:**
   - A tabela de controle `supabase_migrations.schema_migrations` **não existe** no banco local atual.
   - **Causa raiz identificada em `supabase/config.toml` (linha 62):**
     ```toml
     [db.migrations]
     enabled = false
     ```
   - Com `[db.migrations] enabled = false`, o CLI não aplica automaticamente o histórico de migrations em `supabase start` ou `supabase db reset`, evitando sobrescritas não intencionais.

---

## 4. Garantias e Diretrizes de Segurança

- **Sem conexões de produção:** O banco de testes local é completamente autocontido na porta `54322`.
- **Sem execução de comandos perigosos:** Nenhum comando `supabase link`, `supabase db push` ou `supabase db reset` foi executado.
- **Sem remoção de dados:** Nenhum volume ou container Docker foi destruído ou reiniciado com perda de dados.
- **Credenciais intactas:** Arquivos `.env`, `.env.local` e credenciais de produção não foram alterados.

---

## 5. Plano de Ação Seguro para a Próxima Etapa (H3.15)

Com o banco local disponível e mapeado, a homologação real dos contratos e triggers pode ser realizada no banco local sem recorrer à nuvem:

1. **Habilitar ou aplicar pontualmente as migrations pendentes no banco local:**
   - Ordem recomendada (validada na auditoria H3.11):
     1. `supabase/migrations/20261018150000_add_data_inicio_operacao_to_industrias.sql` (adiciona a coluna `data_inicio_operacao` na tabela `industrias`).
     2. `supabase/migrations/20261017120000_create_contratos_lojas_table.sql` (cria `contratos_lojas`, funções de sobreposição, trigger de validação e RLS).
2. **Execução via `psql` direto no container local:**
   ```bash
   # Exemplo seguro direto no container local sem afetar rede externa:
   docker exec -i supabase_db_mk9-data psql -U postgres -d postgres < supabase/migrations/20261018150000_add_data_inicio_operacao_to_industrias.sql
   docker exec -i supabase_db_mk9-data psql -U postgres -d postgres < supabase/migrations/20261017120000_create_contratos_lojas_table.sql
   ```
3. **Execução do Roteiro de Testes SQL com Dados Sintéticos:**
   - Inserção de indústria e loja de teste.
   - Teste da trigger de sobreposição (rejeição de vigências conflitantes).
   - Teste de vigência contínua (`data_fim_vigencia IS NULL`).
   - Teste de vigência determinada com datas válidas.
   - Teste de apuração com ciclo King (23 a 22) e padrão (1 a último dia).

---

## 6. Verificação de Regressão da Aplicação

- **Testes unitários (`contratosService.test.ts`):** 81/81 testes passaram (0 falhas).
- **TypeScript Lint (`npm run lint`):** 0 erros.
- **Build (`npm run build`):** Sucesso absoluto (Vite v6.4.1).
- **Git status:** Working tree preservada, sem commits automáticos.

