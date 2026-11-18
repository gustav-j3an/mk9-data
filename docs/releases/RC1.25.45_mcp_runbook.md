# RC1.25.45 — MCP direto: preparação bloqueada

**Decisão: BLOQUEADO para aplicação.** Este pacote não contém migration DDL executável. O arquivo SQL de mesmo nome é um preflight somente leitura, porque os bloqueios de recuperação e ensaio compatível permanecem. Nada foi aplicado em produção ou homologação.

## 1. Pré-validação de produção

Consulta ao projeto `xzmbesqhxcnuokjwrbnw` por Supabase MCP, em 18/11/2026:
- Estado `ACTIVE_HEALTHY`, PostgreSQL `17.11.0.002`, extensão `pg_cron 1.6.4`.
- Ledger: exatamente 17 versões; lista exata consta no SQL preflight.
- `public.visits`: 43 linhas; zero chaves nulas e zero grupos duplicados em `(promotor_matricula, loja_codigo, industria_codigo, data_visita)`.
- A constraint `visits_promotor_loja_industria_data_unique` existe como UNIQUE, com índice btree nas quatro colunas acima.
- Probe read-only multi-statement no MCP (`BEGIN; SET TRANSACTION READ ONLY; SELECT; ROLLBACK`) retornou `transaction_read_only=on`; não prova atomicidade de DDL.

## 2. Inventário comparativo (catálogo real)

| Objeto | Produção | Homologação |
|---|---|---|
| `attendance_private` schema | presente, mas sem relações (tabelas) | presente |
| `visits.scheduled_date`, `attempt_number`, `occurrence_root_visit_id` | ausentes | presentes |
| `visit_checklist_items.updated_at` | ausente | presente |
| `visit_schedule_actions` | ausente | presente |
| `attendance_private.visit_lifecycle_authorizations` | ausente | presente (verificado por consulta read-only) |
| `attendance_private.scheduled_recovery_authorizations` | ausente | presente |
| `attendance_private.scheduled_attempt_authorizations` | ausente | presente |
| `public.visit_lifecycle_audit` | ausente | presente |
| `industria_skus`, `visit_sku_stock_checks`, `visit_edits_audit_log` | ausentes | presentes |
| `visit_occurrences`, `visit_regularization_audit`, `visit_photos`, `visit_product_validity` | presentes fisicamente | presentes |

Produção também tem `visits.regularization_status`, `visit_regularization_audit`, funções/rotinas auxiliares no schema `attendance_private`, e `attendance_check_in`/`attendance_check_out` legadas. Os triggers atuais de `visits` são `guard_visit_regularization_update` e `preserve_visit_telemetry`; a função `check_visit_promotor_update_integrity` existe, mas não há trigger de visits com esse nome instalado. RLS está ativo nas tabelas históricas examinadas (visits 5 policies, checklist 2, occurrences 2, photos 6, regularization audit 1, product validity 2). Os objetos novos ausentes não têm RLS/ACL que se possa auditar em produção.

### Fontes e incompatibilidades encontradas
M37/M38 no branch incluem as migrations `20261023142837`, `20261106140000`, `20261106150000`, `20261107140000`, `20261108160835`, `20261110150000`, `20261110160000` e `20261110170000`. Essas não são somente tabelas: trocam a constraint antiga por índices parciais, alteram check-in/checkout, autorização single-use, cancelamento, tentativa/raiz, triggers de identidade/expiração e auditoria de ciclo de vida.
A RC1.25 está registrada no ledger da homologação como `20261115160000`, mas a migration de SKUs esperada não existe no diretório `supabase/migrations` do branch consultado (consulta de diretório GitHub; tentativa de buscar o nome esperado retornou 404). Não foi possível reconciliar seu conteúdo-fonte completo e checksum com os objetos de staging. A migration RC1.25.42 da RPC existe no branch, mas em produção a tabela e a função da auditoria ainda não existem.

## 3. Transição da unicidade de visits

As 43 linhas atuais passam a chave histórica (sem nulos nem duplicados). Se as colunas M37/M38 forem adicionadas sem backfill, a transição ainda deve ser validada contra o predicado exato e defaults reais: M37 classifica regulares com `scheduled_date IS NULL`; agendadas separam por rota/data ou store/indústria/data. M38 adiciona tentativa à chave de rota/agendamento. A política de produto `23505` para não permitir retry repetido loja/indústria no mesmo dia depende também do guard de retry; os índices de tentativa, sozinhos, não garantem essa regra. Nenhuma substituição foi executada ou ensaiada na cópia real. Zero duplicatas na chave velha não prova atomicidade, ausência de janela de escrita, ou ausência de conflito sob novos predicados.

## 4. Supabase MCP e atomicidade

A documentação do Supabase MCP lista ferramentas de banco `execute_sql` e `apply_migration`; a segunda aplica uma migration, a primeira executa SQL bruto. O probe multi-statement read-only acima comprova somente que o endpoint aceitou `BEGIN/SET TRANSACTION READ ONLY/SELECT/ROLLBACK`; não se inferiu daí que DDL passado por `apply_migration` será transacional, nem que o ledger aceitará timestamp customizado. Nenhuma DDL ou DML foi chamada. A documentação oficial recomenda cautela e conexão escopada/read-only para dados de produção; o MCP pode expor ações de escrita se habilitadas. Fontes: [Supabase MCP Server](https://supabase.com/docs/guides/ai-tools/mcp), [Supabase changelog](https://supabase.com/changelog.md). A configuração global desta conexão MCP como `read_only=true` não foi confirmada; o relato se limita às chamadas SELECT e ao probe explicitamente `TRANSACTION READ ONLY` desta análise.

## 5. Backup, recuperação e bloqueio

O Supabase MCP não expõe dump/restore físico ou lógico, nem download do artefato #21. A execução antiga de artefatos devolveu lista vazia; o arquivo criptografado e passphrase não foram recuperados, portanto backup íntegro/restaurável não está comprovado. Sem Actions, segredos do environment protegido, custo adicional ou PC do administrador, não foi confirmado runner autorizado para gerar e validar dump e restaurar PG17 com dados reais.
Uma transação atômica pode desfazer DDL se a falha ocorre antes do commit. Após commit, ela não desfaz erro semântico; é necessário restore validado ou compensação previamente ensaiada. Por isso, preflight não substitui backup nem cópia de produção.

## 6. Método futuro, gates e pós-validação

**Não executar ainda.** Se os bloqueios forem removidos e houver nova autorização:
1. Gerar backup com credenciais autorizadas sem expô-las; conferir checksum e restaurar integralmente numa cópia isolada PG17, incluindo o escopo de Storage pertinente.
2. Comparar o catálogo restaurado com os preconditions documentados; abortar para qualquer drift. Testar na cópia o delta exato consolidado, concorrência da unicidade e restauração/compensação.
3. Só depois, confirmar visualmente o project ref e executar uma única migration pelo método auditado, com a transação e o registro gerido por migration; não inserir versão manual no ledger.
4. Validar 18ª versão (única), tabelas/colunas/FKs/constraints/indexes/triggers, RLS/policies e ACLs (RPC authenticated only; anon/PUBLIC sem EXECUTE), health, contagem/integridade das visitas e políticas de retry 23505.
5. Smoke tests aprovados: check-in/checkout, recuperação tentativa 2+raiz, cancelamento/auditoria, bloqueio de retry duplicado do mesmo dia, SKU/estoque antes/depois do checkout, RPC diff real/forjado/no-op, leitura/isolamento de fotos. Interromper imediatamente em project ref/ledger/version mismatch, qualquer colisão, trigger/policy/grant inesperado ou divergência pós-condição.

O banco de produção e homologação não foram alterados; não houve merge, deploy nem workflow. O script em anexo é somente diagnóstico read-only, não está validado por parser PostgreSQL e não é o DDL final.
