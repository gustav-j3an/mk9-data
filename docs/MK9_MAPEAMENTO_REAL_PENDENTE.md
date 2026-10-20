# Inventário real para o mapeamento MK9

> Inventário histórico. Os cadastros não foram corrigidos automaticamente. A implementação atual utiliza [identidades e alocações explícitas de RH](MK9_RH_VINCULOS_IMPLEMENTACAO.md), preservando a organização operacional; não configurar estes relacionamentos por inferência.

Consulta em 19/10/2026, na branch `feat/mk9-faltas-integration`. Apenas SELECTs no banco do **MK9 Date**, identificado pela URL configurada em `.env.local` e pelo projeto Supabase `mk9-data` (`xzmbesqhxcnuokjwrbnw`). Nenhuma consulta ao banco do MK9 Faltas, alteração de produção, navegador, merge, deploy ou uso da chave do anexo.

## Equipes reais encontradas

| Código aceito pelo parser | `equipes.id` (team_id real) | Nome cadastrado | Situação | Supervisor | Promotores compatíveis com a regra atual |
| --- | --- | --- | --- | --- | --- |
| EQP-001 | 189915d1-96a1-42d6-bf1e-55ad2e4919d9 | DF, GO, BA | ativa | SUP-001 | 0 |
| EQP-002 | 3df376f6-fa09-4ad2-a421-cca27da901d5 | GO, MT, MS, TO | ativa | nenhum | 0 |

As equipes existem, mas seus nomes/regionais **não comprovam** correspondência com os projetos do MK9. GO aparece nos nomes das duas equipes; isso também impede uma associação automática unívoca por nome/UF.

## Projetos oficiais fornecidos pelo responsável

| Projeto MK9 | Código MK9 | UUID canônico | Equipe Date confirmada |
| --- | --- | --- | --- |
| COMPARTILHADO 61 | PRJ-000017 | 950edb7d-b94f-4555-9e5a-16fb5aa857a3 | pendente |
| COMPARTILHADO 62 | PRJ-000018 | 600da4d2-4aab-47d6-a81c-3e7a38d717ed | pendente |
| COMPARTILHADO 63 | PRJ-000053 | 1186bb9a-b1b4-4d2b-a8af-4b34646a3a72 | pendente |
| COMPARTILHADO BA | PRJ-000019 | b6f69345-c38e-47be-be0f-f17827fe20bf | pendente |
| COMPARTILHADO GO | PRJ-000020 | 65f7e80f-f615-4ceb-9b8d-80db170735dc | pendente |
| COMPARTILHADO MS | PRJ-000061 | 5d1a46e3-012c-4ab3-a575-834f5ad6a954 | pendente |
| COMPARTILHADO MT | PRJ-000021 | 89bccfec-5f8e-4925-8702-6af0d984d5bf | pendente |
| COMPARTILHADO TO | PRJ-000022 | 46af0780-7b27-4541-92a4-35777992eb6b | pendente |

Os UUIDs acima são os informados no pedido. Não foram validados com a API: a instrução é aguardar a inserção manual da chave antes da homologação real.

## Formato exato existente

`server/mk9-faltas.ts`, função `projectMapping`, espera um objeto JSON cujo **nome de cada propriedade é o UUID do projeto MK9** e cujo **valor é uma lista não vazia de códigos locais `EQP-...`**. O parser não aceita UUID de equipe nem um único valor string.

Estrutura descritiva, não utilizável como configuração:

```text
{"<UUID_REAL_DO_PROJETO_MK9>":["<equipes.codigo confirmado>"]}
```

O `team_id` é apresentado no inventário para identificar a equipe inequivocamente; a configuração precisa usar o `codigo` da mesma linha. O parser foi preservado. O valor final de `MK9_FALTAS_PROJECT_TEAMS` **não foi montado nem configurado**, porque não há vínculo projeto/equipe comprovado no esquema consultado. Um objeto vazio é rejeitado de forma segura.

## Bloqueios reais encontrados

- Existem 44 promotores ativos: 9 possuem `equipe='BRASÍLIA'` e 35 têm `equipe` nula. Nenhum resolve EQP-001/EQP-002 pelo código ou nome atual. Mapear apenas projetos não resolveria essa lacuna; poderia resultar em consultas vazias.
- Os três supervisores (SUP-001, SUP-002, SUP-003) estão ativos, mas todos têm `user_id` nulo. Não existe perfil `gestor` no inventário atual. Portanto, ainda não é possível homologar um supervisor autenticado.
- EQP-002 não possui `supervisor_id`. EQP-001 aponta para SUP-001, cujo UUID é `347a786f-f8c3-4c6a-91dd-7836756781f5`.
- Há 4 perfis de promotor ativos; 2 não encontram um cadastro em `promotores` pela matrícula. Não foi feita correção automática.
- Não foram encontrados perfis de promotor ativos compartilhando a mesma matrícula, nem matrículas locais vazias/com espaços ou iniciadas por zero. Isso não comprova a correspondência das matrículas com o MK9; essa comparação depende da API real.
- Não há entidade de projeto nem coluna de projeto nessas relações consultadas que comprove a correspondência com os oito UUIDs oficiais. Não foi inferida associação por regional, UF ou nome.
- `MK9_FALTAS_API_KEY` e um mapeamento preenchido continuam ausentes no ambiente local. A chave do anexo não foi copiada, configurada nem reproduzida neste relatório.

## Próximo passo do responsável

1. Confirmar a lista completa de códigos de equipe para cada um dos oito projetos. Informar explicitamente projetos ainda sem equipe correspondente, em vez de inventar vínculos.
2. Definir a equipe correta dos promotores, a conta/perfil `gestor` de cada supervisor e o supervisor da EQP-002; resolver os dois perfis de promotor sem matrícula correspondente. Mudanças de cadastro precisam ser realizadas pelo responsável, em etapa autorizada; esta revisão não escreve em produção.
3. Depois da confirmação, montar o JSON final usando os códigos das equipes reais e os UUIDs oficiais. Só então configurar o mapeamento.
4. Inserir manualmente `MK9_FALTAS_API_KEY` como segredo server-side e a URL oficial. Como a chave foi incluída no anexo compartilhado, recomenda-se substituí-la antes de configurar o segredo.
5. Preparar sessões e ocorrências conhecidas para promotor, supervisor e admin, seguindo [o roteiro de homologação](MK9_HOMOLOGACAO_FINAL.md).
6. Executar `npm.cmd run mk9:homologation:check` e, somente com a configuração concluída, `npm.cmd run mk9:homologation:real`. Nenhum desses comandos foi executado nesta etapa, para respeitar a ordem solicitada. Não foram repetidos testes, build ou automação visual já aprovados.

Estado: **inventário localizado; vínculos pendentes; homologação real não executada; merge/deploy não autorizados**.
