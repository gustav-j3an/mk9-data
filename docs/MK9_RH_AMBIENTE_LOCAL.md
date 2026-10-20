# Ambiente isolado de homologação RH

Preparado em 19/10/2026 na branch `feat/mk9-faltas-integration`. Esta entrega prepara o ambiente; **não executa a homologação real**.

## 1. Containers e banco

| Container novo | Serviço | Acesso pelo host |
| --- | --- | --- |
| `supabase_db_mk9-rh-homolog` | PostgreSQL `17.11.0.002`, banco `postgres` | `127.0.0.1:55322` |
| `supabase_auth_mk9-rh-homolog` | Supabase Auth real | Via gateway `/auth/v1` |
| `supabase_rest_mk9-rh-homolog` | PostgREST real | Via gateway `/rest/v1` |
| `supabase_kong_mk9-rh-homolog` | Gateway | `http://127.0.0.1:55321` |

Volume exclusivo: `supabase_db_mk9-rh-homolog`. Projeto CLI: `mk9-rh-homolog`, configuração em `homologation/rh/supabase/config.toml`. O Docker publica as portas 55321 e 55322 nas interfaces do host; o backend Node escuta exclusivamente em loopback. Auth usa confirmação de email desativada e tokens de 15 minutos para o laboratório local, sem SMTP externo.

O stack anterior `mk9-data` continua nas portas 54321/54322/54323/54324, com seus containers e os volumes `supabase_db_mk9-data`, `supabase_edge_runtime_mk9-data` e `supabase_storage_mk9-data` preservados. `mk9-n8n` também foi preservado. Os bancos de testes anteriores dentro de `supabase_db_mk9-data` não foram reutilizados.

Este é o ambiente completo de serviços necessários **ao subsistema RH**: Auth, REST, PostgreSQL e backend. Não é um clone de produção nem uma implantação do restante da aplicação. Não foram habilitados Studio, Storage, Realtime, Edge Functions ou Controle de Presença neste projeto.

## 2. Migrations locais e dependências

Aplicadas somente no novo banco, com registro em `supabase_migrations.schema_migrations`:

| Migration local | Conteúdo |
| --- | --- |
| `20261019155009_rh_local_dependencies.sql` | Dependências de `20260930_create_profiles.sql`, `20260930_create_import_tables.sql` e `20260930_add_status_to_profiles.sql`, seguidas de confinamento exclusivo deste laboratório |
| `20261019155012_rh_explicit_bindings.sql` | Cópia integral da migration canônica `20261019151754_mk9_rh_explicit_bindings.sql` |

Os arquivos foram gerados pela CLI. As dependências antigas compartilham o prefixo `20260930`; foram reunidas em um arquivo local ordenado, sem renomear ou alterar os originais. `homologation/rh/sources.json` registra os SHA-256 das quatro fontes. A verificação confere esses hashes e a igualdade integral da migration RH.

Confinamento local: acesso direto às tabelas e funções operacionais foi revogado para `PUBLIC`, `anon` e `authenticated`. O trigger local de signup força `operador`, ignorando metadata de papel. A migration histórica de status aceitava papel da metadata; essa configuração insegura não foi mantida neste laboratório. A autorização RH continua independente do papel operacional. Estas adaptações estão somente na migration do laboratório; não modificam migrations canônicas ou permissões do ambiente existente.

Não há dependência RH ausente que exija alteração ou consulta à produção. A migration de RH usa `auth.uid()`, `profiles` e `promotores`. Nenhuma migration de presença foi necessária. `assign_attendance_supervisor` não integra este teste de RH; o painel de presença não foi homologado nesta etapa.

## 3. Backend e barreiras de isolamento

Backend: **`http://127.0.0.1:55300`**.

- `GET /health`: mostra o ambiente, o endereço local do Supabase, `externalApiEnabled:false` e o contador de requisições bloqueadas; não mostra chaves.
- `GET /api/rh/acessos`.
- `GET /api/rh/minhas-ausencias`.
- `GET /api/rh/equipe/ausencias`.
- `GET /api/rh/gestao/ausencias`.

O launcher utiliza os handlers existentes; não altera as rotas do produto. Não carrega `.env.local` da raiz, remove variáveis herdadas `SUPABASE_*`, `VITE_*` e `MK9_*`, e carrega somente a URL e a chave pública/anon geradas pelo novo Supabase local. Não persiste a service-role retornada pela CLI.

Toda requisição `fetch` do backend é limitada à origem exata `http://127.0.0.1:55321`, com redirects recusados. A chave MK9 permanece ausente. O comando recusa diretório vinculado por `supabase/.temp/project-ref` e configuração com projeto/portas diferentes. Não usa comandos de link, push, pull ou conexão remota. Nenhum comando desta preparação consultou o Supabase remoto ou a API MK9.

Os arquivos `.env.backend.json`, `.env.synthetic-accounts.json`, PID e logs locais são ignorados pelo Git. Não publique seu conteúdo. As contas sintéticas usam domínio `homolog.invalid`; senhas são geradas aleatoriamente. Tokens de sessão ficam apenas na memória durante a verificação.

## 4. Resultado das verificações

Evidência detalhada: `homologation/rh/verification.json`. Foram aprovadas **37 verificações locais**, além do typecheck dos scripts novos. Não foram repetidos os 268 testes aprovados, o build ou auditorias gerais.

| Verificação | Resultado |
| --- | --- |
| Auth real | Signup sintético, login por senha e `getUser` funcionando; metadata não concede admin |
| REST/RPC | `mk9_rh_scope` disponível para `authenticated`; `anon` bloqueado |
| Tabelas RH | `mk9_identidades`, `mk9_alocacoes` e `mk9_acessos` presentes, RLS habilitada e forçada, políticas restritivas |
| Acesso direto | SELECT/INSERT/UPDATE/DELETE negados nas três tabelas, inclusive para admin operacional |
| Defesa RLS adicional | Mesmo com privilégios temporários em transação, linhas e escrita permanecem bloqueadas; GRANT revertido por rollback |
| Isolamento | Pessoa própria, supervisor e gestor recebem somente a alocação A; pessoa B do mesmo projeto e pessoa C de outro projeto não aparecem |
| Admin sem concessão RH | Escopo vazio nas três visões; nenhum acesso global automático |
| Identidade | Matrícula local `QA-RH-A` e externa `EXTERNA-QA-A` distintas, corretamente projetadas pela RPC |
| Revogação | Retira o escopo imediatamente; ensaio em transação revertida |
| Rotas | Capabilities: 200; sem sessão: 401; sem concessão: 403; tentativa de filtrar outra matrícula: 400 |
| Consulta de ocorrências autorizada | 503 esperado, porque a chave MK9 está ausente; não chama o provedor |
| Saída externa | Zero tentativas de requisição externa no backend |
| Ciclo de vida | Parada e reinício aprovados, com persistência dos dados sintéticos e preservação do stack anterior |

Há quatro contas sintéticas: pessoa, supervisão, gestão e controle sem concessão. As contas de pessoa/supervisão usam papel operacional `operador`; gestão e controle usam `admin`, demonstrando que o papel operacional não substitui concessões RH. Existem três promotores sintéticos, três identidades, três alocações e duas concessões RH. Nenhuma equipe ou rota foi cadastrada; `rotas` permanece vazia.

O teste com concessão temporária de tabela e o de revogação usam exclusivamente transações locais com rollback. Não deixam privilégios adicionais nem revogações persistentes.

## 5. Iniciar, verificar e encerrar

Pré-requisitos: Docker Desktop ativo, Supabase CLI 2.114.0 disponível, dependências npm já instaladas e portas 55300/55321/55322 livres.

Na raiz do repositório, em PowerShell:

```powershell
npm.cmd run rh:local:up
Invoke-RestMethod http://127.0.0.1:55300/health
```

O comando inicia somente este projeto e o backend em segundo plano, sem janela visível. Pode ser chamado novamente com o stack já ativo. A versão PostgreSQL é fixada na imagem já disponível `17.11.0.002`.

Para verificar novamente **somente quando necessário**:

```powershell
npm.cmd run rh:local:verify
```

Esse comando autentica as contas sintéticas e prepara/reutiliza seus registros somente no novo container. Não cadastra dados reais, não consulta a API externa e não carrega o `.env.local` da raiz. Depois de inserir dados reais aprovados em outra etapa, não reutilize automaticamente este ensaio sintético: ele assume um laboratório reservado e testa revogações e permissões temporárias.

Para encerrar, preservando os dados:

```powershell
npm.cmd run rh:local:down
```

O comando identifica o processo do backend pelo caminho completo e para apenas o projeto `mk9-rh-homolog`. Não utiliza `--all`, `--no-backup`, prune ou remoção de volumes. Os serviços foram deixados ativos após a preparação.

## 6. Pendências para homologação real — aguardar autorização

Fornecer e aprovar explicitamente:

- A pessoa piloto: UUID/cadastro local aprovado, matrícula local exata e conta de Auth **deste laboratório** que representará a pessoa.
- UUID oficial do projeto externo e matrícula externa exata, confirmados no MK9 Faltas e Atestados; não presumir igualdade com `PRM-...`.
- Início/fim da vigência de acesso e janela histórica de ocorrências autorizada.
- Contas locais de supervisão e gestão, com concessão individual para a alocação piloto; papel admin não concede gestão RH automaticamente.
- Responsável pela aprovação, data e referência documental para identidade, alocação e concessões.
- Nova credencial MK9, mantendo a anterior revogada, e URL HTTPS oficial confirmada.
- Período do teste e ocorrências/resultados esperados para os três perfis, com autorização para seu tratamento local.

O modelo `supabase/templates/mk9_rh_administrative_load.sql` permanece apenas referência para revisão: não foi executado com dados reais. Não copiar automaticamente cadastros de produção nem aplicar o template com placeholders.

Após nova autorização, preparar uma configuração de execução real separada que mantenha o Supabase exclusivamente em `127.0.0.1:55321` e libere **somente** a origem HTTPS MK9 aprovada. A nova chave será configurada como `MK9_FALTAS_API_KEY` apenas nesse backend; a URL em `MK9_FALTAS_API_URL`. Este launcher sintético remove essas variáveis intencionalmente: configurá-las no `.env.local` da raiz não o habilita. Nunca usar prefixo `VITE_` para a chave.

Não executar agora `mk9:homologation:real`: o harness existente carrega `.env.local` da raiz, que ainda não foi redirecionado para este laboratório. Antes de qualquer uso real, sua configuração e sessões devem ser explicitamente direcionadas ao ambiente local e revisadas, sem fallback remoto.

A liberação real requer: aprovação dos vínculos, contas/sessões locais dos três perfis, configuração backend da nova credencial e destino externo, manutenção do bloqueio a Supabase remoto, e autorização expressa para consultar a API MK9. A aprovação deste ambiente não é aprovação para merge, deploy ou migration em produção.
