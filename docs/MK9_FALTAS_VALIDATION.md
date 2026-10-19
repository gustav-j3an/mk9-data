# Validação da integração MK9 — 19/10/2026

> Evidências da implementação inicial. A entrega posterior de vínculos individuais e seus testes estão em [MK9_RH_VINCULOS_IMPLEMENTACAO.md](MK9_RH_VINCULOS_IMPLEMENTACAO.md). Não representa homologação real da versão atual.

Branch: `feat/mk9-faltas-integration`.

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado, sem erros TypeScript |
| `npm test` | 262 testes aprovados, 59 suítes, zero falhas |
| Testes da integração | 12 testes, incluindo rotas completas com APIs simuladas e timeout de 8 segundos |
| Build de produção | Aprovado, executado também pelo teste de segurança do bundle |
| Bundle com segredo sentinela | 9 arquivos de `dist` verificados; segredo e nome da variável server-side ausentes |
| Navegador — promotor, gestor e admin | Aprovado em 360, 768 e 1440 px |
| Overflow horizontal | Ausente nas nove combinações de perfil/largura |
| Erro, tentar novamente e lista vazia | Aprovado para os três perfis |
| Erros de JavaScript na validação visual | Nenhum |
| `git diff --check` | Aprovado |

Os testes preservam a suíte existente. A validação visual usa uma fixture isolada da nova tela com dados e sessões fictícias; não comprova a configuração de contas reais ou as políticas do banco implantado. Duas capturas foram também inspecionadas visualmente: promotor mobile e admin desktop.

Evidências locais:

- [Resultados dos testes](../scratch/mk9-all-tests.log).
- [Resultado visual por perfil/largura](../scratch/mk9-responsive/results.json).
- [Resultado da varredura do bundle](../scratch/mk9-responsive/bundle-security.json).
- [Promotor mobile](../scratch/mk9-responsive/promotor-360.png).
- [Admin desktop](../scratch/mk9-responsive/admin-1440.png).

A chave fictícia foi passada somente ao processo de build via `MK9_FALTAS_API_KEY`; não foi gravada em arquivo público. A varredura também procura chaves MK9 eventualmente presentes nos arquivos locais de ambiente, sem imprimi-las. A chave real da integração não foi fornecida nesta tarefa.

O build emitiu avisos sobre o tamanho do chunk principal (~1,88 MB antes de gzip) e o uso de `__dirname` na configuração existente do Vite. Nenhum impediu o build; não foi feita refatoração desses pontos fora do escopo.

Não foram executados merge, deploy, testes com a API MK9 real ou alterações de banco remoto. A ativação depende da chave e do mapeamento de projetos/equipes revisado pelo administrador. Ver [configuração, arquitetura, arquivos alterados e limitações](MK9_FALTAS_INTEGRATION.md).
