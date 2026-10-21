# Homologação real: configuração e pendências

> Roteiro histórico do modelo projeto/equipe. Para a implementação aprovada de identidades, alocações e acessos individuais, seguir [MK9_RH_VINCULOS_IMPLEMENTACAO.md](MK9_RH_VINCULOS_IMPLEMENTACAO.md). Não alterar equipes, supervisores ou matrículas para habilitar RH; o JSON de equipes não autoriza mais as consultas.

Revisão realizada em 19/10/2026 na branch `feat/mk9-faltas-integration`, sem navegador, merge, deploy ou operações no Supabase de produção. A implementação da aplicação foi preservada. Foram adicionados apenas roteiro, consultas de leitura e ferramenta de homologação.

## Resultado da revisão

As três funções existem, estão vinculadas ao middleware local do Vite e ficam fora do rewrite da SPA na Vercel. Elas validam o token no Supabase do próprio app, o perfil ativo e o papel (`promotor`, `gestor`, `admin`). O escopo é calculado no backend e reaplicado sobre a resposta MK9, inclusive quando ela vem do cache.

As evidências anteriores permanecem válidas: 262 testes aprovados, typecheck, build, responsividade e varredura do bundle. A suíte funcional, o build e os testes visuais não foram repetidos nesta revisão. A nova ferramenta foi verificada separadamente. O funcionamento com credenciais reais **ainda não está confirmado**: nesta máquina estão ausentes `MK9_FALTAS_API_KEY`, `MK9_FALTAS_API_URL` e um mapeamento preenchido. As credenciais públicas do Supabase do aplicativo estão presentes. Nenhum valor de chave foi exibido.

Verificação desta etapa: o novo teste de CLI passou (configuração sintética válida sem rede, recusa de sessões duplicadas e de URL HTTP). A checagem local real de configuração foi executada e bloqueou por chave ausente, sem requisições externas. O typecheck foi executado para validar o script novo; a suíte funcional e o build anteriores não foram repetidos. O serviço possui URL MK9 padrão, mas o roteiro exige que a URL seja explícita para confirmar o destino escolhido na homologação.

Não há sincronização automática de cadastros ou criação de vínculos. Os projetos do MK9 não correspondem automaticamente a indústrias, regionais ou equipes locais. A integração está preparada tecnicamente; os vínculos de negócio e o contrato real precisam da conferência abaixo.

## Passo 1 — Obter informações verdadeiras

Solicitar ao administrador do MK9, por canal privado:

1. A chave de leitura e a lista exata de UUIDs dos projetos autorizados para ela.
2. Para cada projeto, quais equipes locais realmente pertencem a ele.
3. Matrículas de teste exatamente como retornadas pela API, preservando zeros e formato textual.
4. Um período pequeno com protocolos conhecidos, incluindo ocorrências de pelo menos duas pessoas de equipes diferentes. Para testar separação por projeto, incluir projetos diferentes.
5. Um UUID real de projeto **fora** do escopo dessa chave e a confirmação de que o endpoint deve negar a consulta com 403/404. Resposta 200 vazia não comprova negação e será marcada como não aprovada pela ferramenta.

Não enviar a chave ou tokens nesta conversa. Não inferir vínculos usando apenas nomes parecidos.

## Passo 2 — Conferir os cadastros do aplicativo

Usar os cadastros existentes ou, se necessário, as [consultas somente de leitura](mk9-homologation-readonly.sql) no banco **deste aplicativo**. O arquivo foi preparado, não executado. Nenhuma correção é automática.

| Vínculo | Regra usada pelo backend | Conferência necessária |
| --- | --- | --- |
| Login → perfil | `auth.getUser(token).id = profiles.id`, `status=ativo` | Conta correta e perfil ativo |
| Perfil promotor → pessoa | `profiles.promotor_matricula = promotores.matricula` | Igualdade exata; uma conta não deve apontar para outra pessoa |
| Pessoa → MK9 | `promotores.matricula = colaborador.matricula` | Identificador não pode ser reutilizado para pessoas diferentes entre projetos |
| Pessoa → equipe | `promotores.equipe = equipes.codigo` ou nome com trim/minúsculas | Exatamente uma equipe correspondente; preferência por código existente |
| Supervisor → login | `supervisores.user_id = profiles.id` | Supervisor ativo e perfil `gestor` ativo |
| Supervisor → equipes | `equipes.supervisor_id = supervisores.id` | Equipes ativas e corretamente atribuídas |
| Projeto MK9 → equipe local | JSON `MK9_FALTAS_PROJECT_TEAMS` | Correspondência aprovada pelo administrador, sem associação automática |

`promotores.matricula` é `TEXT UNIQUE NOT NULL` na migration. A comparação com o MK9 não remove espaços, zeros ou pontuação. `001234` e `1234` não são iguais. Isso evita associações inferidas, mas pode resultar em ausência de registros se os sistemas estiverem divergentes. O esquema de perfis não garante que duas contas não apontem para a mesma matrícula: a consulta preparada identifica esse caso. Se houver matrícula reutilizada para pessoas diferentes no MK9, **não aprovar a homologação**; a identidade precisa ser esclarecida antes da ativação.

Gestor sem supervisor vinculado não recebe acesso global. Vínculos ambíguos de equipe são excluídos. Administrador também fica limitado aos projetos mapeados/autorizados e aos promotores vinculados localmente. Histórico de equipe/projeto não é inferido: a consulta usa os vínculos atuais. Revisar transferências para evitar omissões de histórico.

## Passo 3 — Configurar localmente

Editar **`C:\projetos\mk9-date\.env.local`**, preservando as variáveis Supabase existentes. Esse arquivo já é ignorado pelo Git. Adicionar:

```dotenv
MK9_FALTAS_API_URL=https://mk9-faltas-atestados-atualizado.vercel.app
MK9_FALTAS_API_KEY=<chave real, preenchida somente no arquivo privado>
MK9_FALTAS_PROJECT_TEAMS='{"UUID_REAL_FORNECIDO_PELO_MK9":["CODIGO_REAL_DA_EQUIPE"]}'
```

Os marcadores acima precisam ser substituídos; não constituem vínculos sugeridos. O formato real da equipe é `EQP-` seguido de dígitos e o projeto deve ser UUID válido. Pode haver várias equipes por projeto e vários projetos quando isso corresponder ao cadastro real. Não adicionar equipes para apenas fazer o teste passar.

Não usar `VITE_MK9_*`, localStorage ou sessionStorage. A chave não pertence ao frontend, ao código-fonte ou ao arquivo público `.env.example`. Reiniciar `npm run dev` após mudar a configuração. Variáveis já definidas no processo têm precedência sobre arquivos locais; fechar/reabrir o terminal se estiver usando uma configuração antiga. `vite preview` não fornece essas rotas.

Na futura hospedagem, o local correspondente é **Vercel → projeto deste aplicativo → Settings → Environment Variables**. Os mesmos três nomes devem estar no ambiente **Preview** destinado à homologação, com a URL/chave pública do Supabase do próprio app. Alterar variáveis não atualiza uma implantação já executada; a aplicação delas exigirá nova execução/implantação quando você autorizar. Nenhuma configuração Vercel foi modificada agora. Não preencher Production nesta etapa.

## Passo 4 — Preparar casos e sessões privadas

Copiar `docs/mk9-qa-cases.example.json` para **`.env.mk9-qa-cases.json`** na raiz, também ignorado pelo Git. Preencher somente com cadastros e protocolos confirmados. Estrutura de cada item:

```text
projects[]:
  id: UUID real do projeto
  matriculas: lista de matrículas reais com ocorrências conhecidas
  expectedProtocols: lista de protocolos reais esperados nesse projeto/período

actors[]:
  label: apelido local do caso (sem dados sensíveis)
  role: promotor, gestor ou admin
  tokenEnv: nome como MK9_QA_PROMOTOR_TOKEN
  projectIds: lista completa de projetos permitidos para esse caso
  matriculas: lista completa de matrículas permitidas para esse caso
  expectedProtocols: protocolos que obrigatoriamente devem aparecer

start/end: datas YYYY-MM-DD de um período curto com registros conhecidos
forbiddenProjectId: UUID real de projeto fora do escopo da chave MK9
```

É necessário pelo menos um caso de cada papel. O promotor deve ter uma única matrícula. Para promotor e gestor, o período de referência deve conter uma ocorrência conhecida fora de seu escopo; sem esse controle negativo o teste não aprova o isolamento. Cada projeto mapeado precisa de um caso. Usar mais contas para cobrir diferentes equipes/projetos e colaboradores transferidos.

Para cada conta, entrar manualmente no aplicativo e obter seu `access_token` da sessão Supabase vigente (DevTools → Application → armazenamento da sessão do app, campo `access_token`). Isso é o token do **aplicativo**, não a chave MK9. Colocar o token exclusivamente na variável privada indicada por `tokenEnv`, em `.env.local` ou no ambiente do processo. Exemplo de nomes, sem valores:

```dotenv
MK9_QA_PROMOTOR_TOKEN=
MK9_QA_GESTOR_TOKEN=
MK9_QA_ADMIN_TOKEN=
```

Os tokens devem corresponder a contas distintas, com os perfis/vínculos reais revisados. Tokens expiram: obter novamente se o teste negar a sessão. A ferramenta não realiza login, cria usuários ou altera perfis. Remover os tokens após os testes; não versionar ou compartilhar arquivos privados.

## Passo 5 — Executar sem navegador

```powershell
npm.cmd run mk9:homologation:check
# Somente depois da conferência acima:
npm.cmd run mk9:homologation:real
```

O primeiro comando valida a estrutura da configuração sem fazer requisições. Ele não comprova que a chave é válida ou que as associações são verdadeiras.

O segundo realiza apenas GET: consulta a API MK9 real para cada projeto, verifica protocolos/matrículas conhecidos e a recusa do projeto não autorizado. Depois abre um servidor temporário em `127.0.0.1` para executar as **três funções internas reais**, com as sessões fornecidas. O backend usa o Supabase do aplicativo somente para leitura e validação do usuário. Não usa service role, não acessa o banco MK9 e não executa migrations, mutações de Auth, merge ou deploy.

O teste confronta o resultado das rotas com a referência MK9 e com os escopos esperados informados pelo administrador; verifica registros ausentes/duplicados, protocolos conhecidos, acesso sem sessão, troca de papel, adulteração de matrícula/projeto, campos privados e cache HTTP. Um resultado vazio não basta. A saída contém apenas estágios e motivos fixos, nunca chaves, tokens ou respostas externas. Não grava dados operacionais. O teste não passa pela hospedagem Vercel: roteamento e variáveis da implantação Preview ainda precisarão de um smoke test quando ela existir e for autorizada.

Se o período atingir o limite da API, reduzir o intervalo. A API fornecida ainda não define paginação; confirmar a semântica de `meta.count`, `meta.limit`, categorias e status com o MK9. Se o endpoint responder de forma diferente ao projeto proibido, esclarecer o contrato antes de aceitar a homologação.

## O que depende de você

- Chave real de leitura e confirmação da URL do MK9.
- UUIDs autorizados e um projeto fora do escopo para o controle negativo.
- Relação aprovada entre cada projeto e os códigos reais das equipes locais.
- Conferência das matrículas nos dois sistemas, vínculos de perfis/supervisores e possíveis transferências.
- Contas/sessões dos três perfis e protocolos reais esperados em um período pequeno.
- Autorização futura para preparar uma implantação Preview; nenhuma foi solicitada ou executada nesta revisão.

Enquanto esses itens estiverem pendentes, considerar o estado **preparado para executar a homologação**, e não “API real homologada”.
