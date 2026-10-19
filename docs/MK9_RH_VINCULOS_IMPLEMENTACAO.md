# Vínculos exclusivos de RH — implementação para homologação

Branch: `feat/mk9-faltas-integration`. Data: 19/10/2026.

## A. Implementação concluída

Preparada a migration `supabase/migrations/20261019151754_mk9_rh_explicit_bindings.sql`, gerada pela CLI. Os tipos de `promotores.id` e `profiles.id` foram confirmados por consulta de metadados no banco configurado pelo app: ambos são UUID; matrícula local é TEXT. Nenhum SQL de alteração foi enviado ao banco remoto.

### Estruturas

| Tabela | Identidade e restrições | Aprovação e histórico |
| --- | --- | --- |
| `mk9_identidades` | PK/FK `promotor_id → promotores.id`; `usuario_id` opcional e único, FK para `profiles.id` | Estado pendente/aprovado/revogado, aprovador, data, referência administrativa e timestamps |
| `mk9_alocacoes` | PK UUID; FK para identidade; UUID externo limitado aos oito projetos fornecidos; matrícula externa textual exata; únicos pessoa/projeto e projeto/matrícula externa | Vigência atual em timestamps; janela histórica de ocorrências em datas; aprovação, versão e histórico JSON das alterações |
| `mk9_acessos` | PK UUID; FKs para usuário e alocação; tipo supervisao/gestao; único usuário/alocação/tipo | Estado, vigência atual, aprovador, data, referência e versão |

Há índices para usuário/tipo/estado, alocação, identidade e aprovadores. Identidades externas e destinos dos acessos são imutáveis: não há transferência automática de um vínculo para outra pessoa, projeto ou leitor.

Uma identidade pode existir sem conta própria, para que o colaborador apareça em consultas de supervisão/gestão explicitamente autorizadas. Uma conta própria aprovada pode consultar sua pessoa sem preencher ou modificar `profiles.promotor_matricula`. Não há associação por nome, email, UF, equipe ou indústria.

### Vigência, histórico e reutilização

- `valido_desde <= agora < valido_ate` define se uma alocação/acesso pode ser usado **agora**. Fim nulo significa aberto. Comparações usam o relógio do banco.
- `ocorrencias_desde/ocorrencias_ate` define o histórico explicitamente autorizado. O backend intersecta essa janela com o filtro solicitado e descarta ocorrências que ultrapassem a janela aprovada; não divulga parcialmente um registro.
- Registros sem início válido ou sem fim determinável para vários dias são descartados, sem quebrar a tela nem presumir autorização histórica.
- Uma matrícula externa pode repetir em projetos diferentes, pois a chave é **projeto/matrícula externa**. Não pode ser reutilizada para outra pessoa no mesmo projeto nesta versão, nem após revogação.
- Se o cadastro operacional de uma pessoa for excluído por um processo existente, a identidade RH é removida e as alocações ficam revogadas, sem pessoa vinculada. O histórico e a reserva da matrícula externa permanecem. Não se bloqueia a exclusão operacional nem se transfere o vínculo a outra pessoa.
- Exclusão de uma conta remove seus acessos e desvincula sua consulta própria. Exclusão do aprovador revoga vínculos aprovados que perderiam a referência do responsável. Não há escrita em tabelas operacionais pela integração.
- Reativação ou ampliação de um vínculo é uma decisão administrativa nova, com referência revisada. Nenhum reprocessamento automático transforma linhas pendentes em aprovadas.

### RLS e fronteira de leitura

As três tabelas têm RLS habilitada e forçada, políticas restritivas `USING(false)/WITH CHECK(false)` para `authenticated`, sem privilégios diretos de tabela para `PUBLIC`, `anon` ou `authenticated`. Isso bloqueia SELECT direto, INSERT, UPDATE e DELETE, inclusive de um usuário cujo perfil operacional seja admin.

A leitura ocorre por uma RPC estreita, `public.mk9_rh_scope(p_view)`, com proxy `SECURITY INVOKER`. A implementação fica em `mk9_rh_private.scope`, `SECURITY DEFINER`, com `search_path` fixo e todas as tabelas qualificadas. O uso privilegiado é intencional: os vínculos RH precisam ser resolvidos independentemente das permissões operacionais, sem expor tabelas nem conceder acesso a promotores/rotas pelo papel atual. A função não recebe ID de usuário ou matrícula: usa exclusivamente `auth.uid()`, verifica perfil ativo e projeta somente as alocações aprovadas da conta. O schema privado não deve ser incluído nos schemas expostos da Data API.

Nenhuma autorização usa `user_metadata` ou papéis operacionais. `mine` exige identidade própria aprovada; `team` exige acesso de supervisão aprovado; `management` exige acesso de gestão aprovado. Ambos os acessos exigem identidade e alocação aprovadas. Gestor/admin operacional sem concessão RH não recebe acesso global. Não se usa service role no app.

O backend valida a sessão com `auth.getUser`, consulta a RPC antes da API externa e novamente antes de entregar a resposta. Uma revogação, expiração ou alteração detectada na segunda leitura cancela a resposta inteira. Escopos nunca são cacheados. O cache do cliente MK9 guarda apenas a projeção operacional e não substitui a revalidação de permissões. Dados já entregues ao navegador não podem ser retroativamente removidos por essa garantia; novas consultas são bloqueadas.

### Compatibilidade

- Preservadas as três rotas GET `/api/rh/minhas-ausencias`, `/api/rh/equipe/ausencias` e `/api/rh/gestao/ausencias`, assim como o contrato de resposta existente.
- Adicionado GET `/api/rh/acessos`, que retorna apenas três booleanos para navegação RH. Ocultar/mostrar a navegação não constitui autorização: cada rota valida novamente no backend.
- Navegação e escolha de visão RH seguem as concessões específicas, sem alterar `UserRole`, `hasPermission` ou RLS operacional. Uma conta pode possuir consulta própria e concessões RH adicionais sem trocar seu papel operacional.
- O campo `matricula` devolvido à tela continua sendo o código local; somente a chamada server-side usa a matrícula externa.
- Nomes de supervisão apresentados no RH vêm das concessões RH aprovadas; não são inferidos dos supervisores operacionais.
- Totais por projeto contam pessoas distintas nas alocações autorizadas daquele projeto. “Promotores ativos” considera a situação local; um afastamento operacional não revoga por si só o direito de consultar RH.
- `MK9_FALTAS_PROJECT_TEAMS` é legado e não participa da autorização nem é fallback. Sua presença no ambiente não concede acesso.
- Preservados timeout de 8 segundos, mensagens humanas, tradução de status e cache de 45/90 segundos.

### Limites e paginação

O contrato externo não informa cursor/offset. Quando uma consulta atinge o limite, o serviço divide o período em intervalos menores, sempre com o mesmo par aprovado projeto/matrícula. Registros presentes em vários intervalos são deduplicados por identificador interno ou protocolo; divergência entre versões impede resultado parcial. Esses identificadores internos não são devolvidos ao frontend.

Se um único dia atingir o limite, se faltar identificador para deduplicação ou se o orçamento for excedido, a consulta falha de forma segura, sem mostrar totais truncados. Há quatro consultas concorrentes no máximo, orçamento de 20 segundos antes de iniciar novas consultas e teto de 160 subconsultas; uma chamada já iniciada ainda pode consumir seu timeout. Escopos com 500 linhas ou mais são rejeitados para não aceitar truncamento da RPC. Confirmar paginação oficial e volumes reais na homologação; não há suporte inventado a cursores.

## B. Testes locais

O container `supabase_db_mk9-data`, imagem PostgreSQL 17.11, foi inspecionado no Docker Desktop local. O banco de entrega usado foi **`mk9_rh_bindings_20261019_release`**, criado vazio e separado de `postgres`. Bancos de trabalho anteriores também foram exclusivos da tarefa: `mk9_rh_bindings_20261019` e `mk9_rh_bindings_20261019_final`. Nenhum deles contém cópia dos dados reais.

`supabase/tests/mk9_rh_bootstrap_local.sql` fornece stubs das chaves verificadas e função Auth apenas para um banco vazio de testes. Não é migration de produto e não deve ser executado em banco existente. `supabase/tests/mk9_rh_bindings.sql` usa dados sintéticos dentro de transação revertida com ROLLBACK.

Testes SQL aprovados: tradução de matrícula, múltiplos projetos, mesma equipe sem herança de acesso, supervisão parcial, gestão limitada, admin operacional sem concessão, bloqueio de leitura/escrita direta, duplicidade de matrícula, imutabilidade, histórico, expiração, revogação, identidade pendente, anonimato e compatibilidade com exclusão de pessoa/conta. Um snapshot confirma que operações exclusivamente RH não alteram os promotores de teste; as exclusões finais são testes explícitos de compatibilidade referencial em dados sintéticos e também são revertidas.

Testes Node incluem rotas reais com fornecedores simulados, dois identificadores para a mesma pessoa, múltiplos projetos, adulteração de parâmetros, resposta externa fora do escopo, falhas da API/migration, limite por dia, divisão por datas e revogação antes/depois do cache. A suíte anterior permanece incluída em `npm test`.

Comandos da entrega:

Resultados: **268 testes Node aprovados, 59 suítes, zero falhas** na suíte completa. Typecheck aprovado; o comando `lint` existente é o mesmo `tsc --noEmit`. A checagem de CLI foi repetida isoladamente após o ajuste final do roteiro e também passou. O build de produção e a varredura do bundle passaram: 9 arquivos, chave sentinela ausente e nome da variável secreta ausente. Não havia chave real configurada no ambiente. As falhas intermediárias de fixture incompleta e timeout de processo no teste de CLI foram corrigidas; não há falha conhecida nas verificações finais.

A consulta final no banco Docker de entrega retornou zero linhas em `profiles`, `promotores` e nas três tabelas RH, confirmando os ROLLBACKs dos dados sintéticos. As três tabelas RH foram confirmadas com RLS habilitada.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:mk9:bundle
```

O último comando executa o build de produção com chave sentinela e verifica os arquivos de `dist`, sem imprimir credenciais. Evidências locais: `scratch/mk9-all-tests.log` e `scratch/mk9-responsive/bundle-security.json`. Nenhuma automação de navegador foi executada nesta etapa.

## C. Homologação real pendente

Nenhum vínculo real foi inserido, nem os 44 promotores distribuídos. Equipes, supervisores, perfis, matrículas e rotas reais permanecem intactos.

Para preparar os primeiros vínculos, após autorização específica:

1. Responsável confirma promotor local por UUID, conta por UUID, matrícula externa textual, UUID oficial de cada projeto e evidência administrativa.
2. Confirma separadamente a janela histórica e a vigência atual de cada alocação, além das contas leitoras de supervisão/gestão e sua vigência.
3. Revisa `supabase/templates/mk9_rh_administrative_load.sql`. O modelo é bloqueado por padrão; não contém IDs de pessoas ou credenciais reais. A carga insere apenas linhas pendentes e não dá acesso. Para uma segunda alocação, reutilizar a identidade conferida, sem sobrescrevê-la.
4. Após revisão das linhas exatas, um administrador do banco aprova somente seus IDs, com aprovador, data e referência. Usuário admin do aplicativo não recebe poder de escrita nessas tabelas.
5. Configura nova chave em `MK9_FALTAS_API_KEY` e URL em `MK9_FALTAS_API_URL`, somente server-side. Confirmar a revogação da chave antiga no emissor. Não enviar chave ou tokens à conversa.
6. Prepara `.env.mk9-qa-cases.json` e sessões privadas. Em cada ator usar `alocacoes: [{ projeto_id, matricula_local, matricula_externa }]` e protocolos conhecidos. `projects[].matriculas` são externas. `role` no roteiro indica a visão de teste, não autoriza acesso por papel operacional. Se uma conta possuir outras visões aprovadas, listá-las em `allowedViews` (`mine`, `team`, `management`).
7. Executa `npm.cmd run mk9:homologation:check` e depois `npm.cmd run mk9:homologation:real`, somente no ambiente explicitamente autorizado. Exigir ocorrência conhecida fora do escopo de cada ator; sucesso vazio não é aprovação. A ferramenta agora compara a matrícula externa da referência com a matrícula local retornada pelas rotas.

## D. Implantação em produção pendente

A migration foi aplicada apenas nos bancos Docker isolados descritos. Nenhuma implantação, merge ou migration remota foi realizada. A aprovação técnica desta etapa não autoriza cadastrar pessoas reais, implantar em produção ou usar a credencial fornecida anteriormente.

Riscos restantes: validação do contrato e volumes da API real; correspondência documental das identidades; política real de histórico; grants e função privada revisados no ambiente de homologação; configuração do segredo e das funções Vercel. O build mantém os avisos existentes sobre tamanho do chunk e `__dirname`. A ausência de `assign_attendance_supervisor` no banco operacional permanece fora do escopo e não foi corrigida por esta migration.

### Arquivos desta etapa

- Migration `20261019151754_mk9_rh_explicit_bindings.sql` e testes SQL de RH.
- `server/rh-authorization.ts`, `server/rh-handler.ts`, `server/rh-access-handler.ts` e `api/rh/acessos.ts`.
- `server/mk9-faltas.ts` e seus testes; teste de CLI e `scripts/mk9-homologation.ts`.
- `src/lib/rhAccess.tsx`, `src/App.tsx`, `src/components/AppShell.tsx`, `src/views/RhAbsencesView.tsx`, `vite.config.ts`.
- Modelo administrativo, `.env.example` e documentação desta entrega.

As alterações preexistentes em `.gitignore` e `docs/qa/` foram preservadas. Durante a tarefa apareceu também alteração não relacionada em `supabase/migrations/20261019011832_secure_attendance_photos_and_release_contract.sql`; ela não foi feita por esta implementação nem sobrescrita e precisa de revisão separada antes de merge. Nenhum commit ou descarte de trabalho foi realizado.
