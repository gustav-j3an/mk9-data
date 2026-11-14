# MK9 DATE — REGRAS PERMANENTES DE DESENVOLVIMENTO E PUBLICAÇÃO

> Arquivo de orientação para Codex, Antigravity e demais agentes. Aplicar a todas as missões no repositório MK9 DATE. **Este documento define o fluxo desejado; não comprova que a infraestrutura já está configurada.**

## 1. Ambientes e fluxo obrigatório

1. **Desenvolvimento e testes locais (Windows):** editar código e executar lint, typecheck, testes, build e testes de banco isolado localmente. Preferir execução nativa Node/PowerShell/PostgreSQL 17, sem Docker quando dispensável.
2. **Homologação remota:** após aprovação dos testes locais, publicar a versão aprovada no **Cloudflare Pages**, site de homologação `https://mk9-date-homologacao.pages.dev/`. Usar exclusivamente configurações, chaves e banco de homologação (`tafjceemuetqjyngresg`). Confirmar a URL e testar fluxos reais de homologação.
3. **Produção:** somente depois de aprovação explícita do usuário, backup recuperável e verificação das migrations, publicar no **Vercel**, projeto `mk9-data`, banco Supabase de produção `xzmbesqhxcnuokjwrbnw`. Confirmar qual branch efetivamente alimenta o domínio de produção antes de qualquer merge/push nela. Não presumir que é `main` sem verificar.
4. **Nunca** conectar homologação ao banco de produção ou produção ao banco de homologação. Verificar identidade do projeto antes de qualquer operação sensível.
5. A homologação no Cloudflare Pages é remota; os **testes e a preparação** são locais. Publicar em Cloudflare/Vercel exige conexão à internet. Não afirmar que todo o fluxo é 100% offline.

## 2. Política de publicação

- Trabalhar em branch isolada e preservar mudanças, worktrees e arquivos preexistentes.
- Antes de alterar código: `git status`, branch, upstream, `git fetch` e checagem de divergências; não sobrescrever trabalho alheio.
- Ao terminar implementação aprovada: testes relevantes + suíte completa quando viável, typecheck, build, `git diff --check`, commit descritivo e push **somente da branch de trabalho**, verificando sincronização com origin.
- Proibidos `git push --force`, merge automático, deploy automático em produção e aplicação de migrations sem autorização específica.
- **Gate A:** testes locais aprovados. **Gate B:** publicação e validação da homologação, mediante autorização para publicar na homologação. **Gate C:** backup de produção comprovadamente íntegro e restauração testada em ambiente isolado; revisão de migrations e plano de rollback. **Gate D:** aprovação explícita do usuário para migrations e publicação em produção.
- Nunca considerar um push em branch de trabalho como publicação do site principal.

## 3. Docker leve e sob demanda

- Docker é **opcional**, não deve ficar aberto continuamente e não deve ser instalado/iniciado se o teste puder rodar nativamente.
- Se necessário para PostgreSQL/Supabase local: subir **somente os serviços indispensáveis** à missão. Não iniciar toda a stack por padrão.
- Preferir containers descartáveis com limites adequados de memória/CPU e volumes mínimos. Antes de subir, verificar recursos disponíveis e containers existentes.
- Não parar, remover ou modificar containers, volumes, imagens ou redes de outros projetos sem autorização.
- Ao terminar, parar **apenas os containers iniciados pela missão**; remover recursos descartáveis somente se não contiverem dados necessários. Não usar `docker system prune -a`, `docker volume prune` nem limpeza global automática.
- Evitar múltiplas stacks Supabase simultâneas. Documentar quais serviços foram usados, tempo de execução e consumo aproximado de recursos.
- Se o PC estiver sem memória suficiente, interromper com relatório em vez de forçar Docker ou comprometer outros processos.

## 4. Banco, migrations e backups

- Banco de homologação: `tafjceemuetqjyngresg`. Banco de produção: `xzmbesqhxcnuokjwrbnw`.
- Antes de migrations de produção: inventário de migrations aplicadas e pendentes, verificação de ordem/dependências, teste em PostgreSQL 17 isolado e revisão de efeitos sobre dados reais.
- Backup de produção deve abranger dump do banco, Auth e binários do Storage, com manifesto, criptografia `age`, integridade e **ensaio de restauração isolada**. Dump isolado não é backup completo dos arquivos do Storage.
- Utilizar automação local existente `scripts/mk9-prod-backup.ps1` quando validada; não presumir sucesso com base em testes fictícios. Falha de backup bloqueia migrations e publicação de produção.
- Não registrar nem exibir senhas, tokens, service_role, strings de conexão ou chave privada age. Credenciais ficam fora do Git e devem ser usadas por mecanismos seguros.
- Alterar senha de produção pode invalidar integrações: verificar dependências antes de novos resets.

## 5. Rotina de cada missão

1. Diagnosticar estado real de Git, ambientes, ferramentas e recursos; distinguir fatos comprovados de hipóteses.
2. Definir escopo e riscos; evitar reconfigurações, contas, secrets e workflows novos se já houver alternativa local funcional.
3. Implementar mudança mínima e testes de regressão.
4. Executar testes locais; usar Docker somente quando estritamente necessário.
5. Relatar arquivos alterados, testes, bloqueios, commit e push da branch.
6. **Parar** antes de publicar homologação se não houver autorização para essa publicação.
7. Validar homologação após publicação autorizada e obter aprovação para produção.
8. Conferir backup restaurável e migrations antes de produção; pedir autorização específica para aplicar migrations, merge e deploy.
9. Após produção autorizada, conferir deployment, domínio, integridade do banco e fluxos críticos; relatar resultado e plano de reversão.

## 6. Padrão de resposta do agente

- Responder em português brasileiro, de forma curta, objetiva e com status claro.
- Priorizar comandos/scripts únicos e reutilizáveis, sem exigir preenchimentos repetitivos. Reutilizar configurações seguras existentes.
- Não declarar “publicado”, “backup completo”, “restaurado” ou “pronto para produção” sem evidências verificáveis.
- Se houver bloqueio, informar **causa, impacto e próxima ação única**. Não iniciar outra missão paralela desnecessária.

## 7. Referências de operação

- Projeto: MK9 DATE / `mk9-data`.
- Homologação web: Cloudflare Pages `https://mk9-date-homologacao.pages.dev/`.
- Produção web: Vercel; confirmar domínio e branch atuais no painel antes de publicar.
- Ambiente local: Windows, PowerShell, Node.js, Git, cliente PostgreSQL 17 portátil e `age`.
- Os caminhos e scripts devem ser verificados no checkout atual; não assumir que arquivos de outras branches já estão presentes.

**Regra principal:** desenvolver e testar localmente → publicar e validar na homologação Cloudflare Pages → comprovar backup/restauração e aprovar migrations → publicar no Vercel somente com autorização explícita.
