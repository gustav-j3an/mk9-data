# Missão 44 — Preview isolado do Portal do Promotor

Branch dedicada: `codex/m44-promoter-homologation-preview`.

O projeto Vercel `mk9-data` tem variáveis gerais de Preview apontando para o Supabase de produção. Não as altere. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` com escopo Preview **e Git Branch exatamente `codex/m44-promoter-homologation-preview`**. A URL precisa ser `https://tafjceemuetqjyngresg.supabase.co`; use somente a publishable key ativa do mesmo projeto, nunca service role. A chave é pública por desenho e não deve ser copiada para Production nem para variáveis Preview sem escopo de branch.

O Vite falha o build desta branch se a URL não identificar o projeto de homologação ou se a chave não for publishable/anon válida. Depois do push, a Vercel deverá criar um Preview da branch. Antes do login, conferir no deployment o commit/ref e confirmar que as duas variáveis efetivas estão associadas à branch. Não usar o domínio estável do projeto como prova de homologação.

## Escopo funcional e migrations

- Painel, agenda, navegação, filtros, histórico, check-in/check-out: código incluído. Operações de escrita dependem dos contratos de RPC já instalados no banco e não fazem parte da inspeção visual.
- Recuperação semanal e proteção de rotas: M37 incluída no branch; as ações de recuperar/antecipar requerem as migrations M37 correspondentes no banco.
- Cancelamento, expiração/fechamento de sessão e histórico de tentativas: M38 incluída no branch; requer migrations M38 aplicadas e verificadas.
- Não habilitar testes de escrita antes da confirmação do schema/RPC no projeto de homologação. Esta branch não executa migrations.

## Liberação do Preview

1. Fazer push normal desta branch.
2. No projeto Vercel `mk9-data`, adicionar as duas variáveis acima como Preview variables limitadas ao Git Branch desta branch. Não editar as variáveis Preview gerais nem Production.
3. Conferir que o deployment criado é Preview da branch, estado READY e commit esperado.
4. Conferir a configuração efetiva da URL/key pública sem copiar a chave para logs. O guard do build também precisa ter passado.
5. Só então usar a URL única do deployment para login com conta de teste. Para teste visual, navegar e consultar telas; não executar check-in, check-out, recuperação, cancelamento ou regularização sem autorização e backend correspondente.
