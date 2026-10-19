# MK9 DATE — ETAPA H3.10: DIAGNÓSTICO DO AMBIENTE LOCAL DE HOMOLOGAÇÃO

**Data:** 18 de Outubro de 2026  
**Status do Ambiente:** **PARCIALMENTE PRONTO / BLOQUEADO PELO DOCKER DAEMON**  
**Ambiente:** `C:\projetos\mk9-data`  
**Escopo:** Diagnóstico de ferramentas locais, inspeção de configuração Supabase, validação de migrations e plano de homologação isolada.

---

## 1. Ferramentas Disponíveis e Versões

| Ferramenta | Status | Versão Detectada | Diagnóstico Operacional |
| :--- | :---: | :---: | :--- |
| **Docker CLI** | **Instalado** | `29.8.2` (build 7fc2dff) | O binário do cliente Docker está presente e operacional no Windows. |
| **Docker Engine (Daemon)** | **Parado / Inacessível** | — | **Bloqueio:** O serviço Docker Desktop não está rodando (`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`). |
| **Supabase CLI Global** | **Não instalada no PATH** | — | Comando `supabase` não reconhecido globalmente no PowerShell. |
| **Supabase CLI via NPX** | **Disponível e Funcional** | `2.121.0` | Executável sob demanda via `npx supabase` com suporte completo a comandos locais. |

---

## 2. Arquivos de Configuração Encontrados

- **`supabase/config.toml` (Presente):**
  - Projeto: `project_id = "mk9-data"`.
  - Portas locais configuradas: API (`54321`), Banco (`54322`), Shadow DB (`54320`).
  - Major version do Postgres: `17`.
  - Schemas expostos: `["public", "graphql_public"]`.
- **Arquivos de Ambiente:**
  - `.env.example`: Modelo documentado para frontend.
  - `.env.local`: Configurado com credenciais do ambiente de produção.
  - **Atenção:** Será necessário criar temporariamente um `.env.staging` (ou sobrescrever `.env.local` apenas durante os testes) para apontar para `http://localhost:54321` com as chaves locais geradas pelo `supabase start`.

---

## 3. Dependências e Ordem Validada das Migrations

O projeto conta com **24 migrations versionadas** na pasta `supabase/migrations/`.

### 3.1. Tabelas Base Obrigatórias
As tabelas `industrias` e `lojas` são criadas na migration inicial:
- `20260930_create_import_tables.sql` (Cria `public.industrias`, `public.lojas`, `public.promotores` e `public.rotas`).
Portanto, a estrutura base necessária para contratos **já existe** no repositório de migrations.

### 3.2. Ordem de Aplicação das Migrations de Contratos
No Supabase local, o comando `supabase start` aplica automaticamente todas as migrations em ordem alfanumérica/cronológica:

1. `20260930_create_import_tables.sql` -> Criação de `industrias`, `lojas`, `promotores`, `rotas`.
2. `...` (Demais migrations de visitas, profiles, RBAC, equipes, supervisores).
3. `20261017120000_create_contratos_lojas_table.sql` -> Criação de `contratos_lojas`, trigger de overlap (`check_contratos_vigencia_overlap`), lock pessimista e RLS.
4. `20261018150000_add_data_inicio_operacao_to_industrias.sql` -> Adiciona a coluna `data_inicio_operacao DATE NULL` em `industrias`.

> [!NOTE]
> A migration `20261018150000_add_data_inicio_operacao_to_industrias.sql` foi criada após a migration de contratos. Como a tabela `contratos_lojas` não depende estruturalmente da coluna `data_inicio_operacao` (a coluna reside em `industrias` e é manipulada pelo serviço TypeScript), a ordem alfanumérica existente é **100% segura e executável**.

---

## 4. Riscos e Bloqueios Identificados

1. **Bloqueador Imediato:** O Docker Desktop não está rodando no host Windows. Sem ele, o comando `npx supabase start` falha imediatamente ao tentar subir os containers do Postgres, PostgREST, Gotrue e Kong.
2. **Risco de Vazamento de Credenciais:** Ao alternar para o Supabase local, garantir que o frontend aponte para `http://127.0.0.1:54321` com a `anon key` gerada pelo CLI local, sem jamais reutilizar os segredos de produção.
3. **Isolamento de Procedures em Proposta:** A procedure `sync_contratos_from_rotas` revisada está isolada em `supabase/migrations/propostas/20261018160000_proposal_sync_contratos_with_data_inicio.sql`. O Supabase CLI não a executará automaticamente, mantendo a sincronização em lote desligada.

---

## 5. Plano Recomendado para Homologação Isolada (Quando Docker for Iniciado)

Assim que o Docker Desktop for iniciado pelo gestor/desenvolvedor:

### Passo 1: Inicializar o Supabase Local
```powershell
npx supabase start
```
*Gera os endpoints locais e as chaves `anon` e `service_role` descartáveis.*

### Passo 2: Inserir Seed de Dados Sintéticos
Criar script local `supabase/seed.sql` contendo apenas dados de teste:
- Indústria `IND-013` (King - Ciclo 23-22).
- Indústria `IND-001` (Indústria Teste, `data_inicio_operacao = '2026-10-15'`).
- Lojas `LOJ-001` e `LOJ-002`.
- Rotas fictícias associadas.
- Usuário gestor e promotor fictícios em `auth.users` e `public.profiles`.

### Passo 3: Executar a Suíte de 7 Testes de Integração
1. Criação de contrato com valor monetário e início pro-rata.
2. Rejeição de valor por visita nulo/zero/negativo.
3. Rejeição de sobreposição pela trigger `check_contratos_vigencia_overlap`.
4. Criação de novo contrato para par com contrato anterior `encerrado`.
5. Contrato contínuo da KING (`data_fim_vigencia = null`).
6. Bloqueio de inserções não autorizadas via RLS com token de promotor.
7. Teste de concorrência com duas requisições simultâneas para o mesmo par.

### Passo 4: Descartar o Ambiente sem Efeitos Colaterais
```powershell
npx supabase stop --no-backup
```
*Destrói todos os containers, volumes e dados de teste, garantindo 0 resíduos.*

---

## 6. Validação Técnica do Código Local

- `npx tsx --test src/lib/contratosService.test.ts`: **81 testes aprovados** (0 falhas).
- `npm run lint`: **0 erros** (`tsc --noEmit`).
- `npm run build`: **Compilação de produção concluída com sucesso**.
- `git status -s`: Repositório limpo, nenhum arquivo modificado indevidamente, nenhum commit efetuado.
- **Confirmação Expressa de Segurança:** O ambiente remoto de produção não foi acessado, nenhuma migration remota foi aplicada e nenhuma persistência foi realizada.

