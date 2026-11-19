# MK9 DATE — Fast Release v1.0

Procedimento reutilizável consolidado em 19/11/2026, com base no release bem-sucedido RC1.25.53. Objetivo: publicar mudanças com rapidez, segurança, rastreabilidade e sem custo adicional autorizado. Não constitui autorização permanente para produção.

## 1. Equipe e ambientes

- Gustavo Jean: autoriza separadamente escrita no banco e publicação da aplicação.
- Guts (Codex): executor; Levi (Antigravity): coordenador e revisor; Copilot: auditor quando disponível. Se indisponível, registrar substituição e separar execução de revisão.
- GitHub: https://github.com/gustav-j3an/mk9-data; produção na branch main, trabalho em branch isolada.
- Produção: https://mk9-date.vercel.app; Vercel projeto mk9-data, equipe gustavj3an; Supabase xzmbesqhxcnuokjwrbnw.
- Homologação: https://mk9-date-homologacao.pages.dev; Supabase tafjceemuetqjyngresg.
- Confirmar novamente identificadores e permissões a cada missão. Conferir documentação atual dos provedores antes de alterar infraestrutura.

## 2. Escolher a rota mais curta segura

| Tipo | Procedimento |
|---|---|
| Visual/frontend sem mudança de contrato | Branch, revisão, testes, build, autorização de deploy, smoke tests. |
| Funcional sem migração | Acrescentar testes de negócio e homologação. |
| Banco, RLS, RPC, Auth ou dados | Procedimento completo abaixo, incluindo ensaio e backup fresh. |

Não repetir provisionamento nem restauração pesada para uma alteração exclusivamente visual sem impacto no banco. Em dúvida, classificar pelo risco maior.

## 2.1 Modalidades formais

- **Fast Release Light — visual:** alterações de layout, estilos, ícones ou conteúdo visual sem mudança funcional, de contrato, autenticação ou banco. Segue branch isolada, revisão, verificações locais, build, autorização explícita de publicação e smoke tests visuais.
- **Fast Release Standard — funcional sem migrations:** comportamento, componentes ou fluxos da aplicação sem DDL, mudança de RLS/RPC/Auth ou escrita estrutural no banco. Inclui testes do fluxo, typecheck, testes, build e homologação quando integração ou comportamento depender do ambiente. Banco permanece sem alterações.
- **Fast Release Database — estrutural:** qualquer alteração de schema, migration, RLS, RPC, Auth, grants, extensões ou dados. Exige o procedimento completo de preparação, backup fresh restaurável, ensaio integral no laboratório WSL 2/PostgreSQL 17, revisão de preflight e pós-condições, aprovação separada para escrita em produção e aplicação atômica.

Em caso de dúvida, adotar a modalidade de maior risco. A classificação nunca substitui autorização administrativa para produção ou deploy.

## 3. Preparação e ensaio

1. Verificar git status, branch, HEAD, remoto, divergência com main, proteção da branch e workflows. Preservar mudanças preexistentes. Não fazer force push.
2. Mapear dependências, schema real, ledger, policies, grants, RPC e extensões usando MCP em leitura. Verificar compatibilidade do frontend antigo durante intervalo entre migração e deploy.
3. Se houver drift, elaborar reconciliação específica e auditável com fingerprints, assinaturas e pós-condições. Não reescrever migration histórica nem confiar em IF NOT EXISTS indiscriminado.
4. Consolidar SQL e manifest com SHA-256, versões de entrada/saída, preflight e pós-condições. DDL e ledger na mesma transação. Rejeitar comandos de commit intermediário e operações incompatíveis com transação.
5. Restaurar backup em banco local descartável isolado e executar o pacote completo. Comparar contagem e fingerprint dos dados reais, integridade de FKs, índices, constraints, ledger e catálogo. Testar rollback induzido, retries e concorrência, check-in/out, edição, recuperação, cancelamento e SKUs conforme escopo.
6. Conferir RLS, grants, exposição Data API, SECURITY DEFINER, search_path e papéis no ambiente remoto de referência; a restauração sem owners/ACLs não reproduz integralmente serviços gerenciados, Vault, Auth e Storage. Testar autorização positiva e negativa em homologação.
7. Executar npm run typecheck, npm test e npm run build. Testes M37/M38 devem usar API HTTP local obtida via SUPABASE_TEST_API_URL ou API_URL de supabase status -o env; jamais usar porta PostgreSQL como API HTTP e rejeitar URLs externas.
8. Revisar evidências, versionar somente arquivos pertinentes, commit e push da branch. Sem credenciais, dumps ou dados pessoais no Git. Registrar GO/NO-GO; não publicar automaticamente.

## 4. Laboratório econômico já validado

- Debian 13 no WSL 2, PostgreSQL 17.12 (confirmar versão), cluster local 127.0.0.1:55439, sem Docker Desktop.
- .wslconfig: memory=1536MB, processors=2, swap=512MB. PostgreSQL: shared_buffers=128MB, work_mem=2MB. Conferir memória livre e swap antes da carga.
- Backup em /var/lib/postgresql/mk9-private-backups, diretório 0700, arquivos 0600; manter fora do Git e das pastas de sincronização.
- nftables: input/output/forward drop, loopback permitido. pg_cron com cron.launch_active_jobs=off. Nunca iniciar jobs herdados de produção.
- Session Pooler IPv4 histórico: aws-0-sa-east-1.pooler.supabase.com:5432. Confirmar endpoint no painel. TLS verify-full com CA oficial prod-ca-2021.crt (verificar validade e origem). Arquivos libpq .pg_service.conf e .pgpass 0600, proprietário postgres.
- Serviço existente mk9_prod_ro: nome exato, não confundir com mk9-production-backup. Apesar do nome, pode usar postgres administrativo; conferir privilégios e forçar leitura nas sessões de auditoria e backup. Preferir futuramente credencial dedicada de menor privilégio suficiente.
- Credenciais jamais em chat, argumentos, logs ou Git. Não redefinir senha sem autorização e inventário de consumidores. Não repetir autenticação cegamente.
- Liberar firewall apenas durante operação autorizada, para IPs atuais do pooler e TCP/5432, com regra de retorno ct state established,related. Retirar regras temporárias em sucesso, erro ou interrupção e conferir nft list table inet filter. Não desligar firewall.
- Se timeout, testar primeiro TCP no PowerShell do Windows, depois rotas/conntrack WSL. Se TLS ok e autenticação falhar, distinguir serviço inexistente de senha recusada. Não contornar proteção.
- Garantir isolamento e proteção dos dados reais; não assumir que dump lógico recupera todos os serviços Supabase. Verificar cobertura do backup e plano de restauração antes de autorizar escrita.

## 5. Fase 1 — pré-publicação (GO obrigatório)

- Obter autorização da janela e confirmar projeto, pacote, commit e hash exatos.
- Verificar saúde, schema/ledger, compatibilidade, sessões/transações/locks e tráfego operacional atual. Estabelecer controle de concorrência durante a janela (uma consulta instantânea não garante ausência futura).
- Gerar backup fresh via pg_dump 17, TLS verify-full, formato custom, timeout de locks limitado e política de leitura. Registrar UTC, tamanho e SHA-256; validar checksum, pg_restore --list e restauração efetiva em ambiente isolado.
- Preservar backup e registrar baseline atual de contagens e fingerprints. Nunca reutilizar números/backup de uma missão anterior como baseline de uma nova.
- Conferir diferenças entre dump e schema gerenciado: owners, ACLs, extensões, funções e outros serviços. Documentar limites e contingência compatível.
- Qualquer divergência não explicada, backup incompleto ou falha de recuperação: NO-GO.

## 6. Fase 2 — banco de produção (autorização própria)

- Somente com autorização explícita de Gustavo e Fase 1 aprovada, revalidar o baseline e liberar conexão temporária de escrita mk9_prod_rw. Confirmar identidade do destino e privilégios.
- Usar cliente nativo psql pelo Session Pooler, não MCP para lote cuja atomicidade/ledger não esteja demonstrada. Comando-modelo (substituir pelo pacote aprovado e caminho verificado):

```bash
sudo -u postgres psql "service=mk9_prod_rw" -X --single-transaction -v ON_ERROR_STOP=1 -f /caminho/validado/pacote.sql
```

- Pré-condições e pós-condições críticas devem falhar dentro da mesma transação antes do commit. Sem BEGIN/COMMIT internos. Não dividir o pacote em chamadas nem aplicar versão extra automática no ledger.
- Em falha, parar; comprovar rollback antes de decidir próxima ação. Em sucesso, verificar novamente ledger, dados preservados, RLS, RPCs, grants, FKs, índices e saúde.
- Remover serviço temporário e credencial exclusiva de escrita, fechar firewall e registrar evidências. A autorização desta fase não autoriza deploy.

## 7. Fase 3 — GitHub e Vercel

- Autorizar explicitamente merge/deploy após GO do banco quando aplicável.
- Conferir acesso Vercel, equipe, projeto, branch, ambiente de produção e destino Supabase sem revelar valores secretos. Se 403/SSO, aguardar autorização oficial; não contornar.
- Revisar diff e reconciliar main em branch/PR protegida. Preservar modificações legítimas da main e repetir testes no candidato efetivo de merge. Não sobrescrever workflows nem desativar controles.
- Sem GitHub Actions pagos/não autorizados. Verificar gatilhos e proteções antes do push. Usar [skip ci] apenas se autorizado e compatível com workflow e controles obrigatórios; verificar de fato a ausência de runs.
- Selecionar a estratégia Vercel aprovada e compatível com custo zero; não disparar deploy duplicado. Confirmar READY e domínio oficial servindo o commit publicado, build version/ref/commit e destino correto.
- Smoke: login, portal-promotor, portal-industria, acompanhamento-visitas, rotas-fixas e fluxos alterados. HTTP 200 de SPA sozinho não comprova autenticação nem operação real. Testar sessão e ações seguras, sem mutar dados reais sem autorização; revisar erros/logs.
- Após erro pós-commit, interromper e avaliar correção ou rollback de aplicação compatível. Nunca restaurar produção automaticamente: pode apagar dados novos. Qualquer restauração exige autorização, controle de tráfego, avaliação de perdas e plano verificado.

## 8. Registro de conclusão

Registrar missão, horários, atores, versão, SHAs, PR, deploy ID, status, domínio, hashes de backup/pacote, baseline antes/depois, testes, logs, segurança e custo. Declarar GO somente com evidências e limitações explícitas. Arquivar backup conforme política de retenção segura.

### Referência comprovada (histórica, não reutilizar como alvo automático)

RC1.25.53 — 19/11/2026 15:55 BRT: aplicação 2.6.1; 29 versões novas, ledger 17 → 46; 43 visitas preservadas; 577/577 testes e 15 cenários locais; PR #42; merge 395600cefc0a882227aa333a9188fdaf7f8a2dea; candidato 36cd75a427c5effa7b41fa2471b35b360e0d1aba; Vercel dpl_9YKkM9EK5t4XrPQYEA71ZW62Ynig READY; zero runs GitHub Actions e custo adicional zero conforme relatório dos agentes.

Artefatos do repositório: docs/releases/RC1.25.52_production_package.sql, docs/releases/RC1.25.52_runbook.md, docs/releases/RC1.25.49_reconcile_20261022152449.sql e scripts/safe-rc1-25-apply.mjs (atomicidade corrigida no commit 9f28ab3c).

## 9. Prompt de retomada para agentes

“Executem a próxima missão do MK9 DATE usando o FAST RELEASE v1.0, consultando o runbook permanente e os artefatos históricos da RC1.25.53. Classifiquem o risco e adotem a rota mínima segura. Guts executa, Levi revisa, Copilot audita quando disponível. Preservem alterações existentes, isolamento e custo zero. Não repitam provisionamento desnecessário. Validem as mudanças e, se houver banco, restaurem backup em laboratório e ensaiem a transação completa. Exijam autorização separada para escrita em produção e merge/deploy; sem Actions não autorizados. Emitam GO/NO-GO por fase com evidências e parem em qualquer gate não atendido.”

