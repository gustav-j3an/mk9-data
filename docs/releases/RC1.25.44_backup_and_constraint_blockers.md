# RC1.25.44 — Parecer técnico de bloqueios

**Status: BLOQUEADO para DDL de produção.** Este pacote contém apenas um preflight read-only; não é a migration consolidada M37/M38/RC1.25.

## Verificações objetivas
- Produção `xzmbesqhxcnuokjwrbnw`: 43 visitas; as quatro colunas da chave legada estavam preenchidas; nenhuma duplicidade em `promotor_matricula, loja_codigo, industria_codigo, data_visita`.
- Índice legado observado: unique btree nessas quatro colunas.
- M37 substitui a unicidade ampla por índices parciais: linhas sem `scheduled_date` mantêm unicidade diária; visitas agendadas distinguem rota ou ausência de rota. M38 adiciona `attempt_number` e índice por tentativa/rota/agendamento. A unicidade operacional loja/indústria/dia também depende da validação de retry que gera SQLSTATE 23505; essa regra deve permanecer. Zero colisões atuais não valida a execução dos DDLs nem todas as futuras transições.
- Homologação tem 58 versões no ledger e dados/esquema diferentes; seus testes não são ensaio sobre cópia das 43 visitas reais da produção.

## Backup e recuperação
- O Supabase MCP disponível não fornece exportação lógica/física nem listagem/download de artefatos. Nenhuma restauração foi tentada.
- O artefato #21 `mk9-production-backup-43941383469-1.tar.gz.gpg` não foi recuperado nesta sessão. A consulta dos artefatos da execução 43941383469 retornou lista vazia. Isso não prova exclusão, mas não confirma disponibilidade, integridade ou restaurabilidade.
- O workflow de backup é manual, usa environment protegido `production-backup` e depende de `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `BACKUP_GPG_PASSPHRASE`; retenção declarada de um dia. Sem acesso autorizado a esses segredos/Actions, não há caminho comprovado para recuperar #21.
- A documentação oficial descreve backups automáticos nos planos pagos e recomenda `supabase db dump` em Free; gerar e restaurar o dump requer runner autorizado e armazenamento/credenciais seguros. Fonte: https://supabase.com/docs/guides/platform/backups.

## Ensaio isolado
Não foi confirmada alternativa gratuita compatível com PG17 para restaurar e ensaiar uma cópia real sem computador do administrador e sem Actions. A organização Free atingiu o limite de dois projetos ativos; Supabase Branching teve cotação MCP de compute de 0,01344 por hora. Não foi criado branch nem iniciado custo. Isto significa que nenhuma opção foi confirmada sob estas restrições, não impossibilidade universal.

## Decisão e gates
Não gerei DDL consolidado: sem backup recuperável comprovado e ensaio PG17 em cópia real, atomicidade não remove o risco pós-commit nem prova compatibilidade das constraints/triggers. O SQL anexo é somente leitura, verifica o conjunto exato das 17 versões e termina em `ROLLBACK`; não altera o banco.
Para desbloquear: recuperar backup e passphrase por fluxo autorizado, validar checksum e restore em ambiente isolado sem custo proibido, revisar colisões históricas nos índices candidatos e então produzir/auditar a migration consolidada. Não editar ledger manualmente para recuperação; usar snapshot comprovado ou compensação previamente ensaiada e autorizada.

Nenhuma alteração em produção/homologação; nenhum segredo lido; nenhum workflow, restore, merge ou deploy executado.
