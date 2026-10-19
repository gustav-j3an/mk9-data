# Backup e recuperação para implantação de Presença

Este procedimento é preparação. Não foi executado em produção e não comprova a existência de backup remoto. Acesso ao navegador não é necessário para desenvolver/testar o pacote local.

## Critérios para liberar a implantação

- Evidência de backup do banco: origem correta, instante UTC e de São Paulo, status concluído, retenção, tamanho, identificador do ponto recuperável e responsável.
- Cópia dos arquivos Storage com inventário de bucket/caminho, tamanho e SHA-256. Backup de banco não substitui os bytes das fotografias.
- Restauração em destino separado, com contagens, vínculos, horários, telemetria e fotografias comparados; registrar duração e perdas máximas observadas (RTO/RPO).
- Inventário protegido de Auth, configurações externas, Realtime, extensões, funções, permissões e versão do frontend. Segredos ficam no gerenciador apropriado, nunca em relatório, Git ou frontend.
- Aprovação administrativa da janela e autorização explícita para a versão exata das migrations/frontend.

## Antes da janela — execução futura autorizada

1. Confirmar backup/PITR pelo canal administrativo disponível. Registrar o último ponto realmente restaurável, não apenas que um plano oferece backup. Se não houver evidência, parar.
2. Criar backup lógico consistente com ferramenta oficial/pg_dump compatível com PostgreSQL 17 e papéis autorizados. Registrar também definições de roles/ACL e migration ledger. Não assumir que um dump com `--no-owner --no-acl` recupera permissões.
3. Exportar os objetos do bucket privado para destino criptografado, com acesso restrito e retenção aprovada. Gerar manifesto e verificar hashes lendo os arquivos exportados. Não tornar o bucket público para facilitar cópia.
4. Para consistência entre banco e arquivos, controlar gravações durante a captura final e reconciliar metadados/caminhos após a cópia. Documentar qualquer diferença temporal; não declarar cópia atômica entre Postgres e Storage.
5. Manter a referência anterior à implantação protegida contra sobrescrita. Não copiar senhas ou tokens para os comandos apresentados em relatório.

## Ensaio de restauração

1. Usar projeto/base e armazenamento separados, sem integrações de produção, notificações ou credenciais de usuários reais em testes automatizados.
2. Restaurar esquema/dados com falha imediata em erro. Registrar erros de extensões/roles/objetos gerenciados; não tratá-los silenciosamente como sucesso.
3. Reconstituir proprietários, grants, RLS, RPCs, triggers, índices, constraints e parâmetros relevantes. Comparar com o inventário da origem.
4. Restaurar os bytes no armazenamento separado e verificar manifesto/SHA-256. Conferir fotos órfãs, objetos ausentes e referências conflitantes. Não excluir inconsistências automaticamente.
5. Validar com identidades comuns: indústria A não acessa B; supervisor não acessa outra equipe; promotor acessa suas visitas; perfil inativo/sem vínculo/anônimo é bloqueado; administrador autorizado mantém suas funções. Testar URLs privadas e rejeição de acesso público.
6. Aprovar formalmente RPO/RTO medidos. O teste local com arquivo PNG sintético verifica o mecanismo, não a recuperabilidade do acervo real.

## Implantação coordenada

O pacote passa a ter **sete migrations originais e uma corretiva adicional**. A corretiva deve ser aplicada antes da reabertura e da publicação do novo Portal da Indústria, que depende de `industry_routes`. Não publicar o novo frontend antes de as oito etapas estarem concluídas.

Não há garantia de implantação gradual com clientes antigos: a proteção de telemetria bloqueia gravações diretas antigas; a RLS bloqueia consultas industriais brutas. Usar janela coordenada, controlar gravações e atualizar/inutilizar sessões antigas conforme procedimento operacional aprovado. Não enfraquecer RLS para manter versões incompatíveis.

Conferir checksums e o ledger, aplicar somente o pacote autorizado, respeitar transações individuais e limites de lock/tempo, e verificar a recarga de schema do PostgREST. Não executar `db push` no histórico legado divergente.

A migration corretiva aborta se o bucket estiver público, se houver referências históricas compartilhadas entre visitas ou se o executor não puder corrigir o proprietário de defaults inseguros. Esses casos exigem revisão específica; o script não altera dados/configurações reais para forçar a implantação.

## Recuperação em incidente

- Interromper gravações do fluxo afetado; preservar logs/auditoria e o estado anterior e posterior ao incidente.
- Se uma etapa falhar, confirmar rollback e ledger. As anteriores já confirmadas permanecem; não reaplicar arquivos sem inspecionar o estado.
- Preferir correção progressiva de frontend/RPC quando os dados estão íntegros. Não voltar ao cliente que escreve telemetria diretamente nem reabrir permissões industriais brutas.
- Restaurar o ponto escolhido primeiro em destino separado. Comparar gravações posteriores válidas e preparar reconciliação aprovada. Restore em produção pode perder alterações posteriores e exige autorização explícita própria.
- Recuperar fotografias pelos bytes/manifesto; metadados restaurados sozinhos não recuperam os arquivos.
- Antes de reabrir, repetir checks de integridade, testes de acesso e leitura de fotos. Registrar perdas, duração e responsáveis.

## Limites conhecidos

URLs assinadas emitidas antes da restrição podem continuar válidas até sua expiração. A aplicação atual usa até uma hora para exibição; planejar a janela considerando esse prazo. Não registrar essas URLs nos relatórios.

O esquema local reconstruído usa o último inventário disponível; mudanças posteriores no remoto não foram verificadas nesta etapa. Snapshot lógico local e arquivo sintético não certificam backup/PITR de produção. GPS, câmera, rede e upload no celular real continuam dependentes de homologação operacional.
