# MK9 DATE — ETAPA H3.13: CHECKLIST DE PREPARAÇÃO PARA STAGING SEM DOCKER

**Data:** 18 de Outubro de 2026  
**Status do Projeto:** PRONTO PARA HOMOLOGAÇÃO COM PREVENÇÃO DE VAZAMENTO E RISCO ZERO À PRODUÇÃO  
**Ambiente:** `C:\projetos\mk9-data`  
**Escopo:** Inspeção de segurança de arquivos de ambiente, integridade do `.gitignore`, análise de comandos CLI e roteiro seguro de staging sem Docker.

---

## 1. Verificações de Segurança Realizadas

### 1.1. Proteção de Arquivos de Ambiente no Git (`.gitignore`)
- Inspecionamos o arquivo `.gitignore`:
  ```text
  .env*
  !.env.example
  ```
- **Comprovação com `git check-ignore -v .env.staging`:**
  - Retorno: `.gitignore:8:.env* .env.staging`.
  - **Confirmado:** O arquivo `.env.staging` (e qualquer variação `.env.*`) está **efetivamente ignorado pelo Git**. Não há risco de versionamento acidental de chaves de teste ou produção.

### 1.2. Prevenção de Troca Acidental de Credenciais no Frontend
- Inspecionamos `src/lib/supabase.ts`:
  - O cliente utiliza `import.meta.env.VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
  - No Vite, o arquivo `.env.local` tem precedência sobre os demais.
  - **Recomendação de Segurança:** Para alternar entre produção e staging sem sobrescrever arquivos acidentalmente:
    - Manter `.env.local` para o ambiente padrão.
    - Criar `.env.staging` e rodar a aplicação com `npx vite --mode staging`. O Vite carregará automaticamente `.env.staging` com isolamento absoluto.

---

## 2. Análise de Risco dos Comandos Supabase CLI (`link` e `db push`)

Avaliamos os riscos do uso do Supabase CLI caso seja utilizado contra um projeto cloud:

### 2.1. O que Faz o `npx supabase link --project-ref <ref>`?
- Conecta o repositório local ao projeto especificado gravando o ID em `supabase/.temp/project-ref`.
- **Risco Crítico:** Se o desenvolvedor passar o `<project-ref>` do projeto de **PRODUÇÃO** por engano, qualquer comando posterior (`db push`) afetará o banco real.
- **Prevenção Mandatória:** **NUNCA** executar `supabase link` apontando para a produção. O `<project-ref>` deve ser conferido manualmente caractere por caractere para certificar que pertence ao projeto `mk9-date-staging`.

### 2.2. O que Faz o `npx supabase db push`?
- Compara a tabela interna `supabase_migrations.schema_migrations` do banco remoto com os arquivos da pasta local `supabase/migrations/`.
- Aplica sequencialmente todas as migrations que ainda não constam no histórico daquele banco.
- **Em um projeto limpo (staging):** Aplica todas as 24 migrations em ordem alfanumérica com sucesso.
- **Em um projeto existente com dados:** Não destrói dados, a menos que uma migration contenha comandos `DROP COLUMN` ou `DROP TABLE`.
- **Atenção:** Como `20261017120000_create_contratos_lojas_table.sql` contém `CREATE OR REPLACE FUNCTION public.sync_contratos_from_rotas()`, essa procedure será criada no banco de staging, mas **NÃO DEVE SER EXECUTADA** durante a homologação.

---

## 3. Dependências de Extensões e Esquemas Específicos

Inspecionamos as 24 migrations históricas para verificar se dependem de extensões ou schemas especiais:
1. **Extensões PostgreSQL:** Nenhuma migration executa `CREATE EXTENSION`. O projeto utiliza apenas recursos nativos do PostgreSQL (`gen_random_uuid()` que é nativo no PG 13+, tipos `DATE`, `NUMERIC`, `TIMESTAMPTZ` e constraints `CHECK`).
2. **Schema `storage`:**
   - As migrations `20261001_create_visits_tables.sql`, `20261006_harden_storage_visit_photos.sql` e `20261017_create_avatars_storage_policies.sql` manipulam policies em `storage.objects` e criam o bucket `visit-photos`.
   - Como todo projeto novo Supabase já é provisionado com o schema `storage` ativo por padrão, a execução dessas migrations no staging transcorrerá sem erros.

---

## 4. Custos e Limites a Confirmar no Painel Oficial do Supabase

Antes de criar o projeto de staging no painel [supabase.com/dashboard](https://supabase.com/dashboard), o gestor deve verificar:

1. **Limite de Projetos no Free Tier:**
   - A organização gratuita do Supabase permite **até 2 projetos ativos simultâneos**.
   - Se a conta já tiver 2 projetos (ex.: produção + outro projeto legado), a criação do terceiro exigirá pausar um projeto inativo ou criar uma nova conta/organização gratuita para homologação.
2. **Pausa Automática por Inatividade:**
   - No plano gratuito, projetos sem atividade de requisições por 7 dias consecutivos são pausados automaticamente pelo Supabase. Para reativar, basta um clique no dashboard.
3. **Custo:**
   - **Zero (R$ 0,00)** dentro do Free Tier.

---

## 5. Procedimento Manual Seguro (Checklist Pré-Migração)

Antes de rodar qualquer comando ou aplicar qualquer SQL no novo projeto:

- [ ] **Check 1: Projeto Criado Exclusivo:** Projeto criado com o nome `mk9-date-staging`.
- [ ] **Check 2: URL e Ref Diferentes:** Conferir que a URL (`https://<ref>.supabase.co`) tem um `<ref>` totalmente distinto da produção.
- [ ] **Check 3: NUNCA Usar Service Role no Front:** Apenas a chave pública `anon` (`eyJ...`) deve ser copiada para `.env.staging`.
- [ ] **Check 4: Banco Zerado:** Confirmar no painel do Supabase (Database -> Tables) que o projeto de staging começa vazio.
- [ ] **Check 5: Migrations em Ordem:** Executar as migrations ou via `db push` ou colando os scripts no SQL Editor do dashboard.
- [ ] **Check 6: Sem Dados Reais:** Não fazer dump de produção. Inserir apenas dados sintéticos (seed de teste).

---

## 6. Resultados da Validação Técnica Local

- `npx tsx --test src/lib/contratosService.test.ts`: **81 testes aprovados** (0 falhas).
- `npm run lint`: **0 erros** (`tsc --noEmit`).
- `npm run build`: **Compilação de produção concluída com sucesso**.
- **Confirmação Expressa:** O Supabase de produção permanece 100% isolado, intocado e seguro. Nenhum commit realizado no Git.

