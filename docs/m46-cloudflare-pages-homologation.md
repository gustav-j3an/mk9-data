# Missão 46 — Cloudflare Pages homologação

## Build isolado

A branch `codex/m46-cloudflare-promoter-homologation` contém o código M37/M38 herdado da M44 e um guard que reconhece `CF_PAGES_BRANCH` / `CF_PAGES_COMMIT_SHA`. Nessa branch o build só prossegue se `VITE_SUPABASE_URL` identificar `tafjceemuetqjyngresg` e a chave fornecida for publicável (`sb_publishable_`) ou JWT anon cujo claim, se presente, corresponda ao mesmo projeto. Chave `service_role` é recusada.

No Cloudflare Pages, configure as variáveis de build para **Preview branch `codex/m46-cloudflare-promoter-homologation` apenas**, nunca para Production. O guard é uma barreira adicional; confira no painel que o destino efetivo continua sendo homologação antes de permitir qualquer build remoto.

## Push e publicação

Não faça push desta branch até verificar no painel Cloudflare Pages os controles de branch builds/deployments e confirmar que push não publicará um Preview automaticamente. A configuração não está versionada neste repositório. O preview Cloudflare de outra branch pode ser automático mesmo sem atualizar o domínio de produção.

Depois da confirmação no painel, faça push normal desta branch. Uma tentativa de build com valores gerais de produção deve falhar pelo guard. Com as variáveis de Preview branch-scoped corretas, confirme no build log `CF_PAGES_BRANCH`, commit e que o deployment não tem alvo Production antes de compartilhar sua URL.

## Compatibilidade com o banco

As migrations M37/M38 desta branch precisam estar aplicadas e verificadas na homologação antes de testar ações operacionais. Sem M38, cancelamento, fechamento de dia e histórico/tentativas não estão disponíveis. Não use recuperação/check-in para contornar uma visita antiga em andamento; preserve o bloqueio e complete o fluxo M38 com autorização operacional.
