# RC1.25.52 — pacote consolidado e contingência

**Estado:** pacote local em revisão; não autorizado para aplicação remota. Este runbook não autoriza produção nem deploy.

## Conteúdo e atomicidade

`RC1.25.52_production_package.sql` é saída gerada por `scripts/generate-rc1-25-final-package.mjs`. O manifest registra os SHA-256 de cada fonte e do pacote. O SQL exige o ledger histórico exato de 17 versões e 43 visitas; aplica 26 migrations pendentes (a versão `20261022152449` usa o pacote de reconciliação com fingerprints), RC1.25, RC1.25.42 e a nova reconciliação M18, inserindo cada versão somente após seu DDL na mesma transação. A pós-validação exige 46 versões, 43 visitas, políticas M18, diff canônico da RPC e integridade de FKs/índices.

Não edite migrations históricas para compatibilizar o laboratório. O preflight original de `20261118172125` permanece estrito. O gerador ajusta somente a cópia gerada do pacote: versão `pg_cron 1.6` é aceita apenas no banco local fixo `mk9_prod_restore_rc1251_final_v3` por conexão Unix socket/loopback; para qualquer outro banco/endereço a condição continua exigindo exatamente `1.6.4`.

## Restore e ensaio local

Requisitos: WSL Debian 13, PostgreSQL 17 na porta 55439, `cron.launch_active_jobs=off`, dump original legível e checksum esperado. O pg_cron só permite a extensão no banco definido por `cron.database_name`; o helper local altera temporariamente esse destino para a cópia e reinicia o cluster somente se não houver outras sessões. Os jobs continuam desativados. Sempre restaurar o valor original (`postgres`) ao terminar. Os scripts recusam substituir bancos existentes. O restore exclui entradas de schema/extensão Supabase Vault, indisponíveis no cluster local; portanto, não é réplica integral nem comprova ACLs/roles gerenciados. As opções `--no-owner --no-privileges` também removem ACLs. Não interpretar o resultado local como prova de permissões Supabase.

```bash
sha256sum /var/lib/postgresql/mk9-private-backups/mk9-production-20261119T144813Z.dump
pg_restore --list /var/lib/postgresql/mk9-private-backups/mk9-production-20261119T144813Z.dump >/dev/null
sudo bash scripts/rc1-25-52-local-cron-target.sh enable
sudo -u postgres bash scripts/rc1-25-52-local-restore.sh
sudo -u postgres bash scripts/rc1-25-52-local-apply.sh
sudo bash scripts/rc1-25-52-local-cron-target.sh disable
```

The cron-target helper runs as root only to restart the local systemd unit; its SQL statements run as the local `postgres` account. It checks that no other database sessions are connected before restarting.

O pacote deve executar em uma chamada `psql --single-transaction` com `ON_ERROR_STOP=1`. Se restore ou preflight falhar, pare; não relaxe guards, edite o ledger nem reexecute parcialmente. A cópia descartável fica retida para diagnóstico.

## Janela futura de produção — requer autorização separada

1. Congelar alterações concorrentes e confirmar o project ref `xzmbesqhxcnuokjwrbnw` no cabeçalho do Supabase antes de abrir SQL.
2. Gerar imediatamente um dump atualizado via `pg_dump 17`, conexão de leitura TLS `verify-full`, formato custom, `--no-owner --no-privileges` e `--lock-wait-timeout=10s`; gravar fora do Git, conferir `pg_restore --list` e SHA-256 em custódia separada. Falha de backup, restore de validação ou checksum cancela a janela.
3. Confirmar preflight: PostgreSQL 17, `pg_cron 1.6.4`, ledger exatamente igual à baseline aprovada, 43 visitas e fingerprints/objetos esperados. Qualquer drift cancela a janela.
4. Submeter o arquivo inteiro uma única vez pelo método Supabase MCP que preserve `BEGIN`/`COMMIT` e os inserts do ledger na mesma sessão. Não dividir o pacote em chamadas SQL. Se o MCP não garantir uma transação única ou não retornar confirmação inequívoca, pare e use o fluxo de migração previamente aprovado; nunca reconstrua o ledger manualmente.
5. Após commit, executar somente pós-condições de ledger, contagem/fingerprint de visitas, funções, constraints, índices, RLS/policies e ACLs. Qualquer divergência bloqueia publicação do app.
6. Somente após banco e smoke tests aprovados, criar e inspecionar um preview Vercel apontado à homologação. Promover o build testado para produção requer autorização explícita separada; não usar merge em `main`, Actions ou deploy automático.

## Contingência

- **Falha antes de `COMMIT`:** a transação única deve reverter DDL e ledger juntos. Confirme o estado com consultas somente leitura; não repita automaticamente.
- **Resposta MCP ambígua:** considere o estado desconhecido. Consulte ledger, catálogo e contagens somente leitura antes de qualquer nova ação.
- **Falha depois de `COMMIT`:** não há rollback transacional. Mantenha o app sem promoção, capture evidências sem dados pessoais e escolha entre migration corretiva forward-only ou recuperação aprovada do backup fresh. Não execute `DROP` genérico nem restaure sobre a base ativa.
- **Falha Vercel após banco aprovado:** mantenha o banco; reverta somente para build comprovadamente compatível. Se a compatibilidade não estiver demonstrada, suspenda a promoção e siga a contingência operacional aprovada.
- **Aborto imediato:** project ref errado, mismatch de versão/ledger/pg_cron, lock timeout, policy/ACL divergente, contagem/fingerprint diferente, falha RPC/constraint ou resposta MCP incerta.

## Limitações conhecidas

Não aprovar para produção antes de um ensaio verde em restauração limpa, revisão técnica, validação de objetos e ACLs gerenciados e confirmação de que as policies M18 observadas são a regra de negócio correta. O dump não inclui Storage API nem serviços Supabase gerenciados; essa diferença fica fora do restore local.
