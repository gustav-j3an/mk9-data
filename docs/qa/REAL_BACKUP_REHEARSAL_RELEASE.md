# Disponibilização controlada do ensaio de backup real

Este procedimento publica somente o workflow de ensaio no default branch; não incorpora a aplicação nem autoriza alterações no banco de produção.

## Gate de auditoria

O workflow na branch de integração contém deliberadamente AUDITED_SOURCE_COMMIT: PENDING_COPILOT_REVIEW e rejeita qualquer execução enquanto esse valor permanecer. O Copilot deve revisar o commit integral da branch e registrar o SHA exato aprovado. Não usar o HEAD dinâmico da branch como substituto.

Depois da aprovação:

1. Criar uma branch de disponibilização a partir do main atual.
2. Levar para essa branch somente .github/workflows/rehearsal-real-backup.yml (sem migrations, frontend ou outros arquivos de produto).
3. No workflow, substituir o marcador fail-closed pelo SHA integral aprovado pelo Copilot; não aceitar curingas, tags ou referências de branch.
4. Abrir PR específico para main, descrevendo o SHA fixado e limitando o diff ao workflow. Obter revisão/aprovação administrativa normal e respeitar as proteções da branch. Não fazer push direto, merge automático ou merge do pacote RC1.25.
5. Antes do dispatch, exigir aprovador independente no Environment production-backup e impedir autoaprovação. Confirmar a política do Environment sem revelar segredos.
6. Executar manualmente somente a partir de main, selecionar exatamente o SHA aprovado e confirmar o checkbox de restauração. O workflow verifica o SHA fixo antes de pedir acesso ao Environment, baixa o artifact esperado e valida seu tamanho e SHA-256.

O workflow não recebe credenciais Supabase. Após baixar as imagens e identificar o container, a cadeia DOCKER-USER rejeita todo tráfego de encaminhamento originado pelo container PostgreSQL fora da sub-rede Docker dele; regras de ambiente rejeitam URLs, hosts e referências Supabase remotas. O runner mantém conectividade para obter o artifact, mas o banco efêmero não pode egressar para hosts externos.

## Higiene de temporários

Workflow e scripts usam shred como sobrescrita best-effort de arquivos regulares antes da remoção, e removem os diretórios temporários. shred não garante apagamento físico em SSD/armazenamento virtual; a barreira final é o runner hospedado efêmero, descartado ao fim do job. Não emitir logs com dados de linha, segredo ou conteúdo do dump.

## Estado e autorização

A branch de integração não altera main nem o Environment. A PR mínima e a execução protegida são passos posteriores ao parecer do Copilot e dependem das aprovações administrativas existentes. O ensaio não autoriza migrations remotas, merge do produto ou deploy.
