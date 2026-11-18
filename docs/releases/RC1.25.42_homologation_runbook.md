# RC1.25.42 — Homologação e artefatos

## Escopo e estado
Projeto alvo de teste: `tafjceemuetqjyngresg` (homologação), PostgreSQL 17.11. Produção `xzmbesqhxcnuokjwrbnw` não foi consultada por escrita nem modificada.

Antes desta correção, o staging tinha 57 migrations e os objetos M37/M38/RC1.25 já registrados. Foi aplicada pelo Supabase MCP a migration `20261118172125_rc1_25_42_server_derived_completed_visit_edit_diff`; o ledger passou a 58. A linha de migration existe no ledger e a função em runtime foi lida via pg_get_functiondef. A consulta MCP não fornece os bytes exatos enviados originalmente; este arquivo é uma fonte SQL reconciliada, sem alegação de identidade byte a byte com aquela solicitação. O commit inicial do artefato foi reprovado pelo Copilot por falta do terminador da função; esta revisão corrige o arquivo. Não recria M37/M38 nem reaplica RC1.25.

## Mudança
- Acrescenta `visit_edits_audit_log.changes_summary jsonb` com default `[]` e CHECK de array.
- Substitui `save_completed_visit_edit(uuid,text,jsonb,text,jsonb)` mantendo a assinatura compatível.
- Ignora p_changes_summary do cliente, rejeita item_key duplicada após trim() e calcula no servidor o diff real de observacao_geral, checked, valor_texto e observacao, sob lock da visita.
- A transação grava a auditoria e as alterações de checklist juntas; falha reverte ambas.
- Revoga EXECUTE de PUBLIC e anon e confirma a negação a anon no pós-check; preserva RLS e os triggers existentes; não altera `visits`, `visit_photos`, arquivos de Storage nem dados existentes.

## Evidências de testes controlados (transações revertidas)
- RPC de edição: PASSOU. Um fixture sintético temporário produziu quatro mudanças reais; um resumo falso de cliente foi ignorado; repetir os mesmos valores retornou diff vazio. A transação terminou em ROLLBACK; nenhum fixture permaneceu.
- Check-in/checkout: PASSOU em um fixture de visita sintético dentro de transação revertida; status chegou a `concluida`. ID de teste: `c4624eed-c778-44c5-9205-2c8f8909f23e`.
- Cancelamento M38: PASSOU em fixture sintético dentro de transação revertida; status `nao_realizada` e uma linha de auditoria. ID: `ea04f8cf-465a-40b5-9ec0-faf1f2090da1`.
- Recuperação programada M37 / retry M38: NÃO VALIDADO. As tentativas encontraram agenda já executada/sem ocorrência recuperável; não foi criado nem alterado registro persistente.
- SKUs/estoque: NÃO VALIDADO. As tentativas foram bloqueadas pelo guard de domínio (a primeira também usou nome de coluna incorreto); cada chamada transacional falhou e foi revertida.
- Fotos/RLS: leitura confirmou `visit_photos` com RLS ativo, 7 policies e 4 linhas. Upload não foi executado; comportamento por papel não foi exercitado.

## Aplicação e ledger
A migration foi aplicada no staging por `apply_migration`; Supabase registrou a versão automaticamente. Não inserir manualmente uma linha no ledger. A aplicação no ambiente alvo deve usar somente a migration versionada e passar pre/postflight; a repetição não deve ser feita às cegas.

## Runbook para publicação futura
1. Não publicar com os testes M37 recovery, M38 retry e SKUs ainda não validados.
2. Antes de produção, confirmar autorização específica, backup recuperável comprovado e ensaio sobre cópia isolada PG17. Não usar este arquivo como substituto para a reconciliação integral de M37/M38 e RC1.25 em produção.
3. Confirmar branch/commit revisados e auditoria independente aprovada.
4. Aplicar migrations em ordem via Supabase MCP/SQL Editor somente após autorização; confirmar alvo pelo project ref; preservar os 17 registros históricos e validar objetos/policies/grants/RPCs pós-aplicação.
5. Fazer preview deployment pela Vercel só após a autorização de deploy; smoke test com contas de homologação. Produção/Vercel continuam sem alterações nesta missão.
6. Em falha dentro da transação, corrigir e reaplicar somente após verificar ledger e estado real. Depois de commit, usar migration compensatória revisada; não apagar logs nem editar o ledger para “desfazer” histórico.

## Verificações / limites
A versão da migration list confirma 58 registros em staging e a função ativa contém o caminho de diff servidor. Contagens observadas após o teste: `visit_photos=4`, `visit_edits_audit_log=0`, `industria_skus=0`, `visit_sku_stock_checks=0`; testes rollback não deixaram linhas. Um teste de estoque foi interrompido por guard de domínio; não se presume sucesso funcional geral.



## Correções após auditoria estática
- Duplicidade de checklist verificada após normalização com trim().
- EXECUTE explicitamente revogado de anon e incluído no pós-check.
- O SQL não foi reexecutado no banco após essas correções; não se deve alegar validação de parser/PG17 deste arquivo revisado.

