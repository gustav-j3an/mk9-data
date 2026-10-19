# Homologa??o do Controle de Presen?a ? MK9 Date

> **Atualiza??o de pr?-implanta??o:** a inspe??o das pol?ticas reais revelou bloqueios adicionais de Storage, integra??o industrial e paridade. Consulte [PRE_IMPLANTACAO_SEGURA_PRESENCA.md](PRE_IMPLANTACAO_SEGURA_PRESENCA.md). Os resultados abaixo referem-se ? etapa local anterior e n?o liberam produ??o.

## Resultado formal

**N?O HOMOLOGADO para produ??o/opera??o real.** Implementa??o dispon?vel para homologa??o administrativa, com valida??o t?cnica local conclu?da. Nenhuma migration foi aplicada no projeto remoto. Jornadas, toler?ncias e regras reais continuam pendentes de cadastro e aprova??o pela administra??o; n?o foram substitu?das por dados fict?cios.

## Problemas identificados e corre??es

A implementa??o anterior confundia rotas com expediente, aus?ncia de check-in com falta, usava crit?rios diferentes entre cart?es e filtros e apresentava telemetria simulada. Os ajustes manuais n?o tinham persist?ncia audit?vel. Os v?nculos textuais de supervisor estavam vazios; foi confirmada uma equipe sem supervisor. As pol?ticas remotas permitiam leitura industrial de linhas com coordenadas e dados pessoais.

- `src/utils/attendanceEngine.ts`: jornada expl?cita, vig?ncia, exce??es, folgas, f?rias, afastamentos, atestados pendentes/aprovados, toler?ncia configurada e fechamento. Sem par?metros suficientes, n?o confirma falta automaticamente. Rotas n?o criam expediente. Trata virada de dia/fuso, deduplica??o e primeiro check-in real; localiza??o ausente/inv?lida/dist?ncia sem evid?ncia s?o distintas.
- `src/lib/attendanceService.ts`: autoriza??o pelo perfil ativo, consultas paginadas e tratamento de erro; leitura resumida de ajustes sem justificativas para leitores sem permiss?o; RPC para grava??o e hist?rico.
- `src/components/AttendanceJourneyPanel.tsx`: cadastro de jornadas individuais, modelos reutiliz?veis, modalidade livre, intervalos, vig?ncias, exce??es, toler?ncias, localiza??o de trabalho, aus?ncias e feriados. Modelos preenchem uma nova jornada versionada; n?o atualizam retroativamente associa??es j? feitas. Nenhuma carga hor?ria ? inferida da modalidade.
- `src/views/AttendanceControlView.tsx`: mesmos crit?rios para filtros, cart?es e Excel, estados vazios/erro/carregamento, justificativa obrigat?ria, hist?rico, mensagens reais de GPS e sincroniza??o. Atualiza??o peri?dica pausa durante edi??o. Preservado o padr?o visual.
- `src/views/PromoterPortalView.tsx`: check-in/out por RPC, identidade e rel?gio do servidor, precis?o capturada quando dispon?vel e telemetria de sa?da separada da entrada.
- `src/views/IndustryPortalView.tsx`: consultas a views sanitizadas `industry_visits`, `industry_promoters` e `industry_visit_photos`. A prote??o efetiva por API depende tamb?m das migrations, ainda pendentes no remoto.
- `src/types.ts`: campos adicionais de precis?o, sa?da e v?nculo ? jornada. N?o foram reescritos m?dulos alheios ao fluxo.

Supervisor ? resolvido pelo v?nculo ativo da equipe; o status real `ativa` ? reconhecido. Equipe sem v?nculo permanece pendente; nenhum supervisor foi atribu?do arbitrariamente. Gestor vinculado a supervisor tem escopo de equipe; gestor sem esse v?nculo mant?m o papel global existente, sujeito ? valida??o administrativa de perfis.

Feriados usam local de trabalho expl?cito, com preced?ncia municipal/estadual/nacional e comportamento configurado. Sem localidade suficiente diante de feriado regional potencial, a confirma??o autom?tica ? bloqueada. Trabalho em feriado n?o inventa hor?rios. Atestado e ajuste administrativo n?o apagam check-in original.

## Banco e seguran?a

Sete migrations versionadas preparadas e aplicadas somente no Docker local. Criam/reutilizam estruturas de jornadas, aus?ncias, modelos, calend?rio, ajustes e auditoria; validam conflitos de hor?rio e vig?ncias. RPCs protegem telemetria original, usam hor?rio do servidor e serializam tentativas concorrentes. Auditoria conserva respons?vel, instante, anterior/novo e justificativa; altera??es de v?nculos tamb?m t?m hist?rico.

RLS restringe escrita, perfis inativos, acesso industrial bruto e supervisor fora da equipe. Views industriais de barreira de seguran?a usam proje??o expl?cita e predicado de autoriza??o, pois precisam oferecer apenas parte da linha protegida. N?o dependem apenas de esconder campos na interface. As permiss?es locais foram verificadas por SQL e HTTP. Consulte o invent?rio para ordem e restri??es de implanta??o.

## Evid?ncias executadas

| Valida??o | Resultado |
| --- | --- |
| Su?te Node/TypeScript completa | **219 testes, 58 su?tes, 219 aprovados, 0 falhas**, sem ignorados |
| `npm run lint` | Aprovado; este projeto usa `tsc --noEmit`, n?o possui lint estil?stico separado |
| `npm run build` | Aprovado, Vite 8.3.1 |
| SQL local, transa??o com rollback | Aprovado: permiss?es, auditoria, jornadas/modelos/feriados, conflitos e telemetria |
| HTTP local autenticado | Aprovado: privacidade industrial, escopo de supervisor, duas entradas concorrentes retornam o mesmo evento, sa?da preserva entrada, rejei??o an?nima |
| Navegador, administrador | Filtros combinados, ajuste persistido e hist?rico, modelo e associa??o de jornada, data futura, erro de data, estado vazio e exporta??o |
| Excel gerado pelo navegador | Arquivo real validado: uma linha filtrada HOM_ATT_02, sem coordenadas/colunas pessoais sens?veis |
| Navegador, supervisor | Apenas equipe pr?pria; f?rias fora dos indicadores de eleg?veis |
| Navegador, ind?stria | Portal sem administra??o de presen?a, opera??o sanitizada e galeria vazia sem erro |
| Responsividade | 390 ? 844, sem transbordamento horizontal externo |

A su?te cobre expediente com/sem check-in, futuro, folga/sem jornada, toler?ncia, fechamento, atestados, duplica??o, GPS inv?lido/ausente, filtros/exporta??o, permiss?es e datas pr?ximas de meia-noite. Logs locais: `scratch/attendance_test_results.log`, `scratch/attendance_db_finalization.log`; scripts reproduz?veis: `scripts/test_attendance_db.py` e `scripts/test_attendance_api.py` (somente ambiente local).

Durante a valida??o foram corrigidos rein?cio de formul?rio por atualiza??o peri?dica e atualiza??o de campos nativos de hor?rio. Erros transit?rios de automa??o de download/captura n?o constituem falha funcional: o Excel foi localizado e inspecionado. A integra??o industrial foi reconferida no c?digo e a su?te/TypeScript/build passaram ap?s o ajuste final, sem repetir navega??o j? aprovada.

Build conserva avisos de bundle acima de 500 kB e compatibilidade futura de `__dirname` no Vite. N?o impedem a compila??o. N?o foi realizado ensaio de carga, auditoria completa de acessibilidade nem homologa??o jur?dica das regras de jornada.

## Pend?ncias e limites

1. Administra??o cadastrar/aprovar jornadas reais, modalidades, toler?ncias, fechamento, feriados e local de trabalho; corrigir a equipe pendente pelo gerenciamento existente. N?o h? dados reais inferidos.
2. Autorizar e executar implanta??o coordenada das sete migrations e frontend, ap?s conciliar o hist?rico legado. Sem isso, a prote??o e os novos recursos n?o est?o ativos em produ??o.
3. Verificar backup/PITR de produ??o e ensaiar restaura??o. Backup local `pg_dump -Fc` teve cat?logo validado com `pg_restore --list`; restaura??o integral **n?o foi ensaiada**.
4. Validar check-in/out no navegador de dispositivo real, GPS permitido/negado e fotos reais autorizadas. RPCs foram exercitadas por HTTP/SQL; o fluxo de promotor no navegador n?o foi homologado nesta etapa.
5. Geofence real depende de coordenadas de loja, precis?o e raio aprovados. A base inspecionada n?o possui refer?ncia geogr?fica suficiente para afirmar valida??o por dist?ncia.
6. Revisar avisos legados do advisor fora do escopo (search_path, EXECUTE de fun??es e prote??o de senha vazada). N?o foram declarados resolvidos.

Dados e contas usados no navegador s?o sint?ticos e locais. N?o houve escrita remota, deploy ou atribui??o real de supervisor. Valida??o local n?o comprova homologa??o em produ??o.

## Evid?ncias visuais locais

- [Administrador desktop](evidencias/presenca-desktop-local.png)
- [Celular](evidencias/presenca-mobile-local.png)
- [Supervisor](evidencias/presenca-supervisor-local.png)

## Comandos finais

```powershell
node.exe --import tsx --test src/utils/*.test.ts src/lib/*.test.ts src/views/*.test.ts src/components/*.test.ts src/auth/*.test.ts
npm.cmd run lint
npm.cmd run build
```
