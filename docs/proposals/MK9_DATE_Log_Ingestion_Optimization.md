# MK9 Date — diagnóstico e otimização de Log Ingestion

## Escopo e estado

Projeto Supabase `mk9-data` (`xzmbesqhxcnuokjwrbnw`). A observabilidade foi consultada em modo somente leitura para uma janela móvel de 24 horas, aproximadamente 2026-10-21 18:26 a 2026-10-22 18:25. Não foram alterados banco, policies, configuração de logging, branches ou serviços remotos. As alterações de código abaixo são locais e não foram publicadas.

## Diagnóstico dos logs

Contagens por source na janela consultada:

| Source | Eventos | Estimativa de bytes de atributos + mensagem |
|---|---:|---:|
| API Gateway (`edge_logs`) | 44.046 | 140.129.882 |
| Postgres (`postgres_logs`) | 15.097 | 55.236.109 |
| PgBouncer | 13.405 | 3.834.671 |
| Storage | 915 | 2.112.383 |
| Auth | 257 | 209.009 |
| Realtime | 195 | 138.335 |
| PostgREST | 307 | 80.546 |
| Auth audit | 53 | 77.827 |
| Edge Function HTTP/console | 0 na janela consultada | — |

O pico horário observado ficou concentrado nas 13:00–14:00 da série do Logs Explorer: uma hora teve 21.751 eventos de gateway e 10.492 linhas Postgres; a seguinte teve 10.269 eventos de gateway e 4.241 linhas Postgres.

### Erros repetidos confirmados

No Postgres, 14.858 eventos SQLSTATE `42703` da janela foram agrupados por nome da coluna ausente:

| Erro de schema | Eventos | Origem no código/localização funcional |
|---|---:|---|
| `industrias_1.whatsapp_group_link` ausente | 9.882 | Três leituras do portal do promotor tentavam selecionar o campo opcional em `visits`; eram feitas em paralelo e cada leitura iniciava seu próprio fallback. |
| `rotas.encerrada_em` ausente | 4.960 | O portal tentava filtrar rotas por encerramento antes de usar o fallback legado sem esse campo. |
| `industrias.whatsapp_group_link` ausente | 16 | Leitura relacionada fora das três consultas principais do portal. |

No gateway foram observados 10.109 `GET /rest/v1/visits` com HTTP 400 (aprox. 41,3 MB estimados) e 5.041 `GET /rest/v1/rotas` com HTTP 400 (aprox. 17,7 MB). As contagens de gateway e Postgres não coincidem exatamente; são registros de camadas diferentes e não foram tratados como equivalentes.

Também apareceram 499 `GET /rest/v1/presenca` e 498 `GET /rest/v1/diarias` com HTTP 404, originados por leituras opcionais do Cockpit legado. O código transforma resultados indisponíveis em coleções vazias usadas nos cartões. Não alterei esses indicadores sem rever suas regras e seu contrato de dados.

A soma do tamanho serializado dos atributos e mensagens para os erros de coluna ausente no Postgres foi aproximadamente 55,0 MB; os dois grupos de falhas de gateway associados somaram aproximadamente 59,0 MB. A soma (~114 MB por janela) é uma estimativa de payload do Logs Explorer, não o contador oficial de faturamento/ingestão. A documentação Supabase direciona a leitura do uso oficial para Usage no Dashboard e explica que os serviços e camadas registram eventos separadamente ([Logs](https://supabase.com/docs/guides/observability/logs), [Logs Ingest](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest)).

## Auditoria de frontend

- Confirmadas as leituras de compatibilidade repetidas em `PromoterPortalView`: a agenda cobria o mesmo intervalo de 90 dias que a segunda consulta usada para derivar visitas anteriores; ambas selecionavam os mesmos campos e a segunda lista era apenas consolidada de volta à primeira.
- O portal faz uma consulta adicional de visitas `em_andamento` sem limite de data. Ela foi mantida porque precisa encontrar visitas antigas fora da janela de 90 dias.
- O probe para `whatsapp_group_link` era executado em três leituras concorrentes; o probe para `encerrada_em` se repetia nas cargas de rotas.
- Não foi encontrado loop de polling que explique esses erros. `VisitsTrackingView` e `AttendanceControlView` atualizam dados intencionalmente a cada 60 segundos. O intervalo de 1,5s em `PWAInstallPrompt` só inspeciona a presença de um elemento no DOM, sem chamada de rede.
- Foram encontrados dois canais Realtime na aplicação inspecionada; ambos removem o canal no cleanup do efeito. Não apareceu evidência de assinatura duplicada no código auditado.
- Não apareceu retry ilimitado relacionado aos erros do portal; os retries atuais são fallbacks de schema. Realtime teve 195 eventos e não lidera o consumo observado.

## Correções locais

1. `promoterPortalQueryCompatibility` agora memoriza o resultado de schema no escopo da aba. Três consultas concorrentes compartilham uma única verificação inicial; depois que o campo opcional é confirmado ausente, consultas futuras usam o fallback sem gerar outro 400. Se o campo existe, as leituras continuam selecionando-o. A detecção continua limitada a erro de coluna ausente.
2. `routeClosureCompatibility` memoriza a presença/ausência de `encerrada_em` durante a vida da aba. Depois de confirmação de ausência, recargas utilizam diretamente o fallback já existente.
3. `PromoterPortalView` deixou de executar a leitura duplicada de visitas passadas. O conjunto anterior à data de hoje é derivado da lista da agenda, que já cobre os mesmos 90 dias e a inclui. A consulta de visitas ativas sem limite de data permanece.
4. Foram adicionados testes para probes concorrentes, cache de schema, fallback legado e derivação das visitas passadas da agenda.

## Estimativa e limites

Na janela de referência, as 9.882 falhas do campo de WhatsApp dividem-se exatamente em 3 por 3.294 grupos potenciais de carga do portal. Com a consulta redundante removida e o probe compartilhado, espera-se reduzir as falhas de coluna desse fluxo para cerca de 1 por grupo/aba (até ~6.588 menos registros Postgres `42703`, cerca de 66% desse subconjunto) se a distribuição de tráfego se mantiver. A remoção da segunda leitura também elimina uma chamada de `/visits` por carga do portal. A memória é reiniciada em recarga total da página; portanto pode haver um probe inicial por nova aba/carga.

Essa é uma previsão derivada de contagens e comportamento do código, não uma redução observada. Como não houve deploy, a redução real no projeto Supabase ainda é zero/não mensurável. Os tamanhos estimados de log não equivalem ao contador do billing; confirmar a diferença no Dashboard após publicar por fluxo normal de release. Nenhuma mudança de nível/configuração de logs foi feita.

## Validações

- `npm run typecheck`: aprovado.
- `npm test`: aprovado, 424/424 testes, 73 suites.
- `npm run build`: aprovado; aviso existente do bundle maior que 500 kB e aviso de compatibilidade de `__dirname` no Vite.
- `git diff --check`: aprovado.

## Arquivos de código alterados nesta otimização

- `src/views/PromoterPortalView.tsx`
- `src/utils/promoterPortalQueryCompatibility.ts`
- `src/utils/promoterPortalQueryCompatibility.test.ts`
- `src/utils/routeClosureCompatibility.ts`
- `src/utils/routeClosureCompatibility.test.ts`
- `src/utils/promoterPendingVisits.ts`
- `src/utils/promoterPendingVisits.test.ts`

## Pendências

- Medir ingestão no Usage do Dashboard depois que a versão de frontend com a otimização estiver publicada por um fluxo autorizado; deploy não foi feito nesta solicitação.
- Investigar os 404 de `presenca`/`diarias` em uma tarefa que confira o contrato de dados e os indicadores antes de alterar o Cockpit.
- Conferir o limite atual aplicável ao projeto no Dashboard: a documentação pública consultada não é um contador do uso específico do projeto e indica que quotas/preços de Log Ingest estão em rollout.
