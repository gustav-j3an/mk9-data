# Atualiza??o final da auditoria

O diagn?stico inicial abaixo ? um **registro hist?rico**, anterior ? implementa??o final. As refer?ncias antigas a tr?s migrations, elegibilidade por rotas, aus?ncia de testes de navegador e privacidade industrial ainda sem solu??o foram superadas pelo c?digo e pelos testes locais descritos em [HOMOLOGACAO_PRESENCA.md](HOMOLOGACAO_PRESENCA.md). Permanecem v?lidas como retrato da base remota inspecionada, que n?o recebeu migrations.

Estado final: sete migrations preparadas/aplicadas apenas localmente; jornadas expl?citas e configur?veis; telemetria preservada; leituras industriais sanitizadas; 219 testes aprovados, TypeScript e build aprovados. Produ??o **n?o homologada**, com regras reais e implanta??o pendentes. A pol?tica remota original continua sem a corre??o at? implanta??o autorizada.

Consulte [o invent?rio](MIGRATIONS_PRESENCA_INVENTARIO.md) para ordem, depend?ncias e diverg?ncias do hist?rico. O relat?rio de homologa??o ? a refer?ncia atual de resultados e limites; as se??es seguintes n?o descrevem o estado final do c?digo.

---

## Registro hist?rico do diagn?stico e primeira etapa

# Diagnóstico confirmado antes das alterações

Inspeção do código e consultas somente de leitura no projeto `mk9-data`
(`xzmbesqhxcnuokjwrbnw`), em 18/10/2026.

## Fluxo atual

`src/views/AttendanceControlView.tsx` consulta diretamente `promotores`, `rotas`
e `visits`. `src/types.ts` define quatro indicadores. A programação quinzenal
compartilhada está em `src/utils/routePlanner.ts`. Autenticação/perfis estão em
`src/auth/AuthProvider.tsx`; cliente em `src/lib/supabase.ts`.

- Presente: qualquer visita concluída/em andamento, sem ordenar o primeiro check-in.
- Falta: todas as visitas não realizadas; não há fechamento ou expediente consultado.
- Atestado: apenas edição local, sem consulta de registros persistidos.
- Sem registro: restante dos promotores incluídos.
- Sem nenhuma rota no dia, todos com equipe entram como escalados.
- Cartões usam lista integral; tabela usa filtros; exportação não gera arquivo.
- Ajuste manual modifica status e texto de telemetria apenas no estado React.
- Há botão de simulação, sincronização fictícia e descrição de geofence sem evidência.

## Esquema remoto efetivamente encontrado

`promotores.equipe` e `.supervisor` são textos. `equipes` possui `codigo`, `nome`,
`supervisor_id`, `supervisor_nome`, `status`. `supervisores` possui `id`, `nome`,
`status`, `user_id`. `rotas` possui dias booleanos, `frequencia` e vínculos textuais
por matrícula/códigos. `visits` possui `data_visita` DATE, `started_at` TIMESTAMPTZ,
latitude/longitude numéricas, mas nenhuma precisão GPS. `lojas` não possui
latitude/longitude. Não é possível validar geofence com esses dados.

Não existem remotamente `promoter_attendance_records`, `promoter_attendance_audit_log`,
`promoter_work_schedules` ou `promoter_absences`. Há duas migrações locais ainda não
versionadas propondo essas tabelas. Backups em `scratch` e relatórios anteriores
não são implementação ativa nem comprovação de implantação.

Dados agregados: 44 promotores ativos, todos sem supervisor textual; duas equipes,
uma sem `supervisor_id`; 12 visitas, nenhuma duplicação da chave operacional e nenhum
check-in ativo/concluído sem `started_at`. Não há justificativa para inventar um
supervisor para a equipe sem vínculo. Resolver vínculo existente na leitura,
sem modificar cadastros ou escalas.

`system_settings` contém apenas `operation_mode=IMPLANTACAO` e
`official_start_date=null`; não há tolerância, fechamento ou início cadastrados.
Não confirmar faltas automáticas sem configuração e expediente conhecidos.

## Segurança

RLS de visits permite gestão a admin/gestor, escrita própria ao promotor e leitura
por operador, próprio promotor ou indústria vinculada. Essa última leitura entrega
também coordenadas; deve ser tratada no banco, não apenas escondida na tela.
Perfis têm trigger bloqueando alterações de papel/status por não administradores,
mas a política de INSERT próprio exige apenas id: precisa impedir criação própria
com papel privilegiado. Consultas de ajustes devem exigir perfil ativo no servidor.

As propostas locais de horários/folgas contêm RPCs SECURITY DEFINER sem autorização
por linha. Devem virar INVOKER. A proposta de auditoria define horários/tolerâncias
padrão e não serializa ajustes simultâneos: requer correção antes de implantação.

## Escopo da correção

Extrair regras puras, serviço paginado, integrar tela/exportação e ajustes auditados,
consultar folgas/expedientes quando disponíveis e mostrar dependências ausentes.
Preparar hardening incremental, sem aplicar migrações em produção nesta auditoria.
Não alterar módulos de indústrias, lojas ou portal já modificados no workspace.

Resultados de testes e limitações serão registrados após a implementação.

## Correções implementadas

- `src/utils/attendanceEngine.ts`: classificação única por matrícula/data; escala
  semanal e quinzenal usa o planejador existente e histórico anterior; expediente
  explícito também permite elegibilidade. Folga aprovada exclui dos indicadores;
  licença médica e ajustes distinguem pendente/aprovado. Não inferir folga só pela
  ausência de rota. Registros fora da programação podem ser inspecionados por opção,
  identificados como não elegíveis, sem entrar nos cartões.
- Estados: aguardando expediente (data futura ou antes do início conhecido), sem
  registro, presente, atrasado, falta confirmada, folga/afastamento, sem expediente,
  atestado pendente/aprovado. Atrasado integra o cartão Presentes; aguardando integra
  Sem Registro. Atestados nas datas sem programação não entram nos indicadores.
- Falta automática exige operação oficial, data de início oficial, expediente
  conhecido, tolerância e fechamento cadastrados, além das dependências disponíveis.
  Fecha no maior limite entre fim do expediente, início+tolerância e fechamento.
  Expedientes noturnos terminam no dia seguinte. Visita não realizada não é falta.
- Primeiro `started_at` válido, com offset e não futuro, ordenado por instante,
  fornece o horário. `created_at` e status da visita não fabricam check-in.
  `data_visita` permanece a data operacional persistida, inclusive na virada do dia.
- Coordenadas são verificadas como números finitos e dentro dos limites. A função
  suporta distância/precisão/raio quando disponíveis, mas o serviço não consulta
  colunas inexistentes: hoje a localização só pode ser ausente, inválida ou capturada
  sem validação. Nenhuma coordenada bruta vai à tabela ou à exportação de presença.
- `src/lib/attendanceService.ts`: consultas paginadas, erros propagados, perfil ativo
  conferido no banco, acesso ao fluxo limitado a admin/gestor/operador; respostas
  antigas não sobrescrevem a data selecionada. Falta de migração tem aviso explícito
  e desabilita gravação/fechamento automático; erro de permissão não é tratado como
  migração ausente. Reconsulta a cada minuto, sem carimbo de sincronização fictício.
- `AttendanceControlView.tsx`: filtros combinados, cartões e XLSX derivam da mesma
  seleção. Quando a opção de mostrar não elegíveis está ativa, a exportação inclui
  essas linhas com coluna Elegível=Não; os cartões continuam contando só elegíveis.
  Exportação efetivamente cria XLSX. Ajustes usam RPC, exigem justificativa e só
  informam sucesso após confirmação do banco. Telemetria original é preservada.
  Foram retirados simulação, histórico biométrico fictício, comparativos fictícios
  e inferência de vínculo CLT. Mantidos layout e contato WhatsApp autorizado.
- Modal com foco contido, Escape, rótulos acessíveis e rolagem em telas pequenas;
  carregamento indica `aria-busy`. Esses comportamentos ainda exigem QA no navegador.

## Migrações locais revisadas/preparadas

As propostas `20261018220000` e `20261018230000` já estavam não versionadas no
workspace e não existem no banco remoto. Foram revisadas: sem horários, tolerância
ou raio inventados; ajuste exige perfil ativo; lock transacional serializa ajustes
na mesma matrícula/data; consultas de folga/expediente são SECURITY INVOKER;
expedientes podem cruzar a meia-noite. Nenhuma escala ou vínculo foi preenchido.

Nova migração `20261018232256_harden_attendance_audit_permissions.sql`, criada pela
CLI instalada: nega escrita direta em ajustes/log; restringe leitores ativos;
impede INSERT próprio com papel privilegiado e UPDATE próprio da identidade
operacional (matrícula/indústria). Mantém provisionamento pelo backend e gestão de
identidade por administrador ativo. Esse hardening é necessário porque os vínculos
do perfil participam das políticas de acesso às visitas.

O log contém responsável, instante, registro anterior, novo status/dias/justificativa;
primeiro ajuste tem valor anterior nulo porque não havia override persistido.
O histórico original de visits permanece separado. Dias informados no ajuste são
metadados: não criam afastamentos nas datas seguintes automaticamente.

**Nenhuma migração ou alteração de dados foi aplicada ao projeto remoto.**
As três migrações foram executadas juntas no PostgreSQL Docker local em transação
revertida; portanto também não permanecem implantadas no ambiente local. O teste
não certifica replay completo do histórico legado nem `supabase db push`.

## Validação executada

| Verificação | Resultado final |
|---|---|
| Suíte TypeScript existente e novos testes | 180 passaram, zero falharam; 26 testes novos |
| `npm.cmd run lint` (`tsc --noEmit`) | Passou |
| `npm.cmd run build` | Passou; avisos de bundle >500 kB e `__dirname` no Vite |
| SQL transacional local | Passou com ROLLBACK |
| Alteração da telemetria original após ajustes | Nenhuma, comparada integralmente com snapshot contendo visita sintética |
| Deploy, navegador autenticado, celular, GPS real | Não executados |

Testes novos cobrem presença, sem check-in, visitas não realizadas, expediente
futuro, folga aprovada/pendente, sem expediente, tolerância nos limites, fechamento,
modo implantação, atestado pendente/aprovado, ajustes preservando telemetria,
duplicidade, horário inválido/futuro, GPS e precisão, supervisor ambíguo, filtros,
exportação XLSX com roundtrip, paginação/erro parcial, datas/fuso e expediente noturno.

O SQL verifica admin e gestor gravando com auditoria; operador sem mutação e sem
leitura do log; promotor vendo apenas sua folga/expediente via RPC; perfil inativo
e anon bloqueados; escrita direta e impersonação por alteração do próprio perfil
bloqueadas; inserção própria privilegiada bloqueada. Fixtures e DDL são revertidos.
Concorrência real entre conexões não foi exercitada; o lock foi revisado no SQL.

Reprodução em Windows:

```powershell
node.exe --import tsx --test src/utils/*.test.ts src/lib/*.test.ts src/views/*.test.ts src/components/*.test.ts src/auth/*.test.ts
python scripts/test_attendance_db.py
npm.cmd run lint
npm.cmd run build
```

O runner SQL usa exclusivamente o contêiner local `supabase_db_mk9-data`; não lê
credenciais nem `.env`. A primeira execução SQL encontrou fixture sem cidade/UF,
foi revertida automaticamente e corrigida. A primeira execução TypeScript dos
testes novos encontrou mocks sem `name` de PostgrestError, corrigidos antes dos
resultados finais acima. Restrições do sandbox ao Docker/tsx foram superadas com
execução autorizada; não representam falha da funcionalidade.

## Pendências de homologação e limites da auditoria

1. Aplicar as três migrações revisadas num staging compatível, conferir histórico
   legado, grants/Data API e depois implantar junto com o frontend. Hoje, em produção,
   a tela revisada continuará em modo limitado e ajustes permanecerão desabilitados.
2. Cadastrar horários, folgas, tolerância e fechamento reais; não foram inventados.
   O sistema está em IMPLANTACAO e sem início oficial. Confirmar com operação que o
   fechamento deve ser o maior limite descrito acima e homologar jornadas noturnas.
3. Resolver administrativamente a equipe sem supervisor. Todos os 44 campos textuais
   vazios não justificam preencher pessoas arbitrariamente; vínculo existente da
   equipe é usado na leitura. Vínculos/escala atuais não têm versionamento temporal,
   portanto não certificam a escala histórica de um promotor hoje inativo/realocado.
4. Homologar fluxo autenticado admin/gestor/operador, edição/reconsulta, concorrência,
   download real, estados vazio/erro/carregamento, teclado e responsividade no navegador.
5. Geofence real requer precisão capturada e referência geográfica da loja, com raio
   oficialmente configurado. Não foram adicionadas colunas vazias como prova de GPS.
6. Privacidade global ainda exige decisão de autorização: a RLS remota de `visits`
   permite à indústria vinculada ler a linha inteira, incluindo coordenadas. O fluxo
   de presença limita perfis e não exporta coordenadas, mas isso não remove a permissão
   direta já existente no portal industrial. Validar essa autorização e preparar
   leitura sanitizada do portal se coordenadas não forem autorizadas. **Não afirmar
   que o frontend resolve a exposição por API, nem que a segurança global está pronta.**
7. O advisor remoto também retornou avisos anteriores de search_path mutável,
   funções SECURITY DEFINER executáveis e proteção de senha vazada desabilitada.
   Nenhum foi classificado automaticamente como exploração confirmada. Funções
   fora de presença não foram alteradas nesta entrega. Remediações oficiais:
   [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
   [EXECUTE anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
   [EXECUTE autenticado](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
   [senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Referência de RLS consultada durante a implementação:
[Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
