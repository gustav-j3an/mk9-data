# Consulta MK9 Faltas e Atestados

> Arquitetura inicial, substituída na resolução de identidade/escopo por [vínculos exclusivos de RH](MK9_RH_VINCULOS_IMPLEMENTACAO.md). Não usar projeto/equipe como fallback. A nova migration está preparada e validada somente no Docker local, sem implantação remota.

Implementada na branch `feat/mk9-faltas-integration`. Não foi realizado merge, deploy nem alteração de banco remoto.

## Arquitetura

`RhAbsencesView → /api/rh/* → rh-handler → mk9-faltas → API externa MK9`.

O frontend envia somente o token da sessão do próprio app e o período. As funções Vercel validam esse token com `auth.getUser`, carregam o perfil ativo do banco do próprio aplicativo e consultam seus vínculos mantendo as políticas RLS existentes. Não há acesso ao banco do MK9 nem uso de service role.

Rotas exclusivamente GET:

- `/api/rh/minhas-ausencias`: perfil `promotor`, matrícula exclusivamente do perfil autenticado.
- `/api/rh/equipe/ausencias`: perfil `gestor`, vínculo ativo em `supervisores.user_id`, equipes ativas por `equipes.supervisor_id` e promotores por código ou nome normalizado da equipe. Gestor sem vínculo não recebe escopo global.
- `/api/rh/gestao/ausencias`: perfil `admin`, projetos explicitamente mapeados no servidor e autorizados pela credencial MK9.

O serviço revalida o escopo local em cada consulta, inclusive ao usar cache. Rejeita parâmetros de identidade, papel, matrícula ou projeto no navegador. A consulta deve informar `data_inicio` e `data_fim`, com intervalo de até 366 dias. Filtros por pessoa, projeto, supervisor, tipo e status operam somente sobre a resposta já autorizada.

O backend projeta uma lista explícita de campos operacionais. Não retorna UUID, CID, anexos, observações, contatos, auditoria nem códigos internos de status. Um status desconhecido vira “Em processamento”.

## Configuração no servidor

Configurar no ambiente das funções Vercel, por ambiente de implantação:

```dotenv
MK9_FALTAS_API_URL=https://mk9-faltas-atestados-atualizado.vercel.app
MK9_FALTAS_API_KEY=<fornecida pelo administrador MK9>
MK9_FALTAS_PROJECT_TEAMS={"UUID_REAL_DO_PROJETO_MK9":["EQP-001","EQP-002"]}
```

O JSON deve conter UUIDs reais e códigos reais de equipes. Não copiar o exemplo literalmente. O mapeamento é obrigatório porque a base atual não possui uma entidade de projeto MK9 relacionada às equipes. Deve ser revisado pelo administrador: mapeamento ausente/inválido bloqueia a integração; equipes não mapeadas e vínculos ambíguos ficam fora do resultado. A API MK9 continua sendo a autorização final dos projetos; uma negativa da API não é contornada.

As funções também usam a URL e a chave **pública do Supabase deste aplicativo**, já existentes em `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (ou `VITE_SUPABASE_ANON_KEY`). Opcionalmente podem ser fornecidas no servidor como `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`. As consultas usam o token validado do usuário; não configurar uma chave administrativa.

Nunca prefixar as variáveis MK9 com `VITE_` ou disponibilizá-las ao navegador. Não inserir a chave real no repositório, na fixture de teste ou na documentação. Não é necessário alterar o esquema ou armazenar os registros do MK9 no banco local.

Em desenvolvimento, `npm run dev` carrega essas variáveis do ambiente local e oferece as mesmas três rotas como middleware server-side. Em produção, são funções Vercel; `vite preview` sozinho não fornece backend. O rewrite da SPA exclui `/api/`.

## Interface e indicadores

- Promotor: Meu RH → Minhas Ausências; protocolo, tipo, período, dias, retorno e status amigável.
- Supervisor: Equipe RH → Faltas e Atestados; indicadores e histórico apenas da equipe vinculada.
- Admin: Gestão RH → Faltas e Atestados; projetos, supervisores, promotores e ocorrências com filtros progressivos.
- Período inicial: primeiro dia do mês até hoje, no fuso de São Paulo. Totais são identificados como “no período”, inclusive quando o usuário muda as datas.
- Promotores ativos são contados pela situação do cadastro local, dentro das equipes mapeadas. O resumo de supervisor identifica explicitamente os “promotores com ocorrências”, não o efetivo total.
- Projetos sem ocorrências usam um nome genérico (“Projeto autorizado 1”), pois o contrato fornecido não inclui catálogo de projetos. O UUID nunca é mostrado.

## Resiliência e limites conhecidos

- Timeout externo de 8 segundos, timeout das consultas de autenticação/banco e orçamento para consultas sequenciais de projetos. O frontend cancela após 35 segundos.
- Cache operacional em memória por credencial/projeto/período/matrícula: 45 segundos para promotor/supervisor e 90 segundos para gestão; até 250 entradas. Instâncias serverless mantêm caches independentes.
- Falha não utiliza dados vencidos nem altera outras telas. Exibe mensagem humana e permite tentar novamente. Logs contêm apenas códigos fixos de erro, sem exceções ou respostas externas.
- O contrato disponibilizado não define cursor/offset. Ao atingir o limite informado pela API (até 100) ou detectar contagem incompleta, a tela pede um período menor. Não há totais silenciosamente truncados. Um contrato de paginação será necessário para grandes volumes que não caibam mesmo em intervalos menores.
- Históricos dependem da matrícula, equipe e mapeamento atuais do aplicativo. Mudanças históricas de projeto/equipe não são inferidas. Colaboradores externos sem vínculo local são excluídos de forma segura; validar a cobertura dos cadastros na homologação.
- Nomes de projeto e supervisor são usados como filtros de apresentação. Cadastros homônimos podem aparecer agrupados; a autorização usa UUID/código no servidor.
- Webhook não foi ativado. O serviço de consulta e a normalização estão separados das rotas para permitir evolução futura, sem criar endpoint de escrita nesta fase.

## Verificação reproduzível

```sh
npm run typecheck
npm test
npm run test:mk9
npm run test:mk9:bundle
```

`npm test` executa todos os arquivos `.test.ts` existentes em `src` e `server`. Os testes da integração incluem escopo dos três perfis, gestor sem vínculo, perfil inativo, equipe ambígua, campos opcionais, status novos, falta de chave, chave inválida, indisponibilidade, timeout, cache, resposta truncada e rotas completas com Supabase/MK9 simulados. O teste das rotas verifica adulteração de matrícula/projeto/papel e uma resposta externa contendo registros indevidos.

`test:mk9:bundle` gera o build com uma chave fictícia sentinela e varre todos os arquivos de `dist`. Também verifica a ausência de qualquer chave MK9 configurada nos arquivos de ambiente locais, sem imprimi-la. A evidência é gravada em `scratch/mk9-responsive/bundle-security.json`.

Teste visual com Playwright disponível no ambiente de QA:

```sh
# Primeiro iniciar npm run dev.
# QA_BASE_URL deve apontar para a porta exibida pelo Vite.
# PLAYWRIGHT_MODULE_PATH é opcional, caso Playwright esteja instalado fora do projeto.
npm run test:mk9:responsive
```

`tests/fixtures/mk9-rh.html` é uma fixture isolada, fora da entrada do bundle de produção. A autenticação e a API são substituídas exclusivamente no navegador de teste, sem bypass no código do app. O teste cobre os três perfis em 360, 768 e 1440 px, ausência de overflow horizontal, abertura do histórico, erro, retry e lista vazia. Capturas e resultado ficam em `scratch/mk9-responsive/`.

## Arquivos desta implementação

- `server/mk9-faltas.ts`: cliente externo, normalização, cache e configuração de projetos.
- `server/rh-handler.ts`: autenticação, escopo, filtros e resposta sanitizada.
- `server/mk9-faltas.test.ts`: testes de segurança e resiliência.
- `shared/mk9.ts`: contrato operacional e tradução de status.
- `api/rh/minhas-ausencias.ts`, `api/rh/equipe/ausencias.ts`, `api/rh/gestao/ausencias.ts`: funções Vercel.
- `src/views/RhAbsencesView.tsx`: tela por perfil.
- `src/App.tsx`, `src/types.ts`, `src/components/AppShell.tsx`: navegação e permissão da nova tela.
- `vite.config.ts`, `vercel.json`, `.env.example`: backend local, roteamento e configuração.
- `package.json`, `scripts/run-tests.mjs`, `tests/mk9-bundle-security.mjs`, `tests/mk9-responsive.mjs`, `tests/fixtures/mk9-rh.*`: comandos e verificação.
- Este documento e `docs/MK9_FALTAS_VALIDATION.md`: operação e resultados.

As alterações preexistentes em `.gitignore` e `docs/qa/` não fazem parte da integração e foram preservadas.

## Antes de produção

A chave real ainda não foi fornecida. Configurar chave, projetos/equipes reais e validar em uma implantação de homologação com contas reais dos três perfis. Confirmar os vínculos e a situação dos promotores, a semântica de `meta.count/limit`, os nomes de categoria/status e a cobertura de históricos. Depois repetir os checks e revisar o diff antes de merge/deploy. Esta implementação não publica nem modifica o sistema MK9.

Referência de autenticação consultada: [Supabase auth.getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
