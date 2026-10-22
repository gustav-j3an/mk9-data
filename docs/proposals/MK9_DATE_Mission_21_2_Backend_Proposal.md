# MK9 Date — Missão 21.2: proposta de mudança no backend

**Estado: proposta para revisão; não aplicar.** Este documento está fora de `supabase/migrations` para não ser executado por engano. A regra nova não está ativada. Os check-ins permanecem bloqueados enquanto a RPC atual estiver instalada.

## Causa confirmada no código versionado

`public.attendance_check_in` identifica a matrícula a partir de `profiles` e exige perfil ativo com papel `promotor`. Calcula `operational_date` no servidor usando `America/Sao_Paulo`, ou o fuso e a regra de jornada aplicáveis. Em seguida adquire `pg_advisory_xact_lock(hashtextextended(matricula, 1))` e recusa o check-in quando encontra **qualquer** registro da mesma matrícula com `status = 'em_andamento'`. O predicado atual não filtra data nem `started_at`; por isso uma visita antiga aberta também bloqueia o dia atual.

O lock consultivo serializa chamadas à RPC por matrícula. A constraint `visits_promotor_loja_industria_data_unique` só garante unicidade por `(promotor_matricula, loja_codigo, industria_codigo, data_visita)`; ela não representa “uma visita ativa por promotor/dia”. Não foi localizado índice único global para visitas ativas.

Há dois triggers relevantes em `public.visits`: `preserve_visit_telemetry` protege a telemetria e `trg_visit_promotor_update_integrity` valida atualizações feitas por promotores. O último permite a transição de uma visita `em_andamento` para `concluida`, sem validar a idade operacional da visita. A RPC `attendance_check_out` também valida matrícula, status e sequência dos horários, mas não rejeita check-out de visita antiga.

As políticas atuais das tabelas `visit_checklist_items`, `visit_photos`, `visit_occurrences` e `visit_product_validity` autorizam escrita do promotor dono com base em `status = 'em_andamento'`, sem limite temporal. `attendance_private.photo_upload_allowed` também aceita upload para qualquer visita em andamento do promotor. Portanto, apenas mudar o predicado da RPC não implementaria a regra de preservação imutável de visitas antigas.

## Regra proposta

1. Conservar a identidade do promotor derivada de `auth.uid()`, validação de rota/autorização e cálculo da data operacional no servidor.
2. Conservar o lock consultivo por matrícula. Sob esse lock, bloquear somente outra visita iniciada no mesmo dia operacional calculado no servidor; permitir retry idempotente da mesma visita.
3. Calcular o dia operacional de uma visita antiga usando `started_at` e o fuso/jornada ligados a `work_schedule_id`, com fallback `America/Sao_Paulo` para registros sem jornada. Para jornada que cruza meia-noite, aplicar a mesma regra de subtração até `hora_fim` usada pela RPC.
4. Fazer `attendance_check_out` e o trigger de integridade rejeitarem mutações de promotor quando o dia operacional original da visita não for o dia operacional atual. Admin/gestor mantêm o caminho administrativo já autorizado e sujeito às políticas de equipe existentes.
5. Restringir também escrita nas tabelas filhas e upload/alteração/exclusão de fotos por meio de guardas restritivas que exijam visita própria em andamento **e** do dia operacional atual. Manter leitura de histórico e acesso administrativo conforme as regras atuais.
6. Não alterar, encerrar, migrar de status ou apagar registros antigos. Não criar índice parcial antes de auditar duplicatas antigas; o lock continua protegendo a concorrência do caminho RPC.

## Fragmento da alteração central proposta

Este é o predicado a incorporar na substituição revisada de `attendance_check_in` depois do lock e depois de obter a linha alvo `result`. A função auxiliar deve derivar a data da visita a partir de `started_at` e da jornada salva em `work_schedule_id`, tratando jornada noturna da mesma forma que a RPC atual.

```sql
-- attendance_private.visit_operational_date(started_at, work_schedule_id)
-- retorna o dia operacional do início, usando o fuso e as horas da jornada salva;
-- sem jornada salva, usa America/Sao_Paulo.

IF EXISTS (
  SELECT 1
  FROM public.visits v
  WHERE v.promotor_matricula = matricula
    AND v.status = 'em_andamento'
    AND v.id IS DISTINCT FROM result.id
    AND (
      v.started_at IS NULL -- estado sem início não pode ser liberado automaticamente
      OR attendance_private.visit_operational_date(v.started_at, v.work_schedule_id)
         = operational_date
    )
) THEN
  RAISE EXCEPTION 'Another visit is in progress today';
END IF;

IF FOUND AND result.started_at IS NOT NULL THEN
  RETURN result; -- retry idempotente da mesma visita, depois de validar outros ativos de hoje
END IF;
```

Antes de adotar esse fragmento, a revisão deve confirmar a assinatura e implementação da função auxiliar para o schema real, o tratamento de `work_schedule_id` nulo e o comportamento idempotente atual.

## Objetos a incluir na migration revisada

- Helper privado para calcular o dia operacional de `started_at` com a jornada histórica associada.
- `CREATE OR REPLACE FUNCTION public.attendance_check_in(...)` com o predicado acima, mantendo `SECURITY DEFINER`, `search_path` seguro, grants atuais, validações atuais e lock consultivo.
- `CREATE OR REPLACE FUNCTION public.attendance_check_out(...)` com validação do dia operacional atual antes do update.
- Atualização de `check_visit_promotor_update_integrity()` para impedir que promotor altere ou conclua uma visita antiga por DML direto; manter o bypass administrativo existente.
- Helper `visit_write_allowed(visit_id)` e políticas **RESTRICTIVE** para escritas nas quatro tabelas filhas, para que políticas permissivas legadas não permitam alterações de visitas antigas.
- Atualização da guarda de upload `attendance_private.photo_upload_allowed` para negar escrita de arquivos de visita antigos por promotor; preservar leitura autorizada do arquivo e os caminhos administrativos atuais.
- Grants/revokes explícitos para todos os helpers privados. Não mudar políticas de leitura do histórico.

Os corpos completos das funções e políticas precisam ser montados contra o schema implantado e revisados como uma única migration transacional. Este documento não é SQL executável nem uma migration pronta para aplicar.

## Validações necessárias antes de ativar

- Conferir no banco de homologação as definições reais de funções, constraints, índices, triggers, RLS, grants, storage policies e versões de jornada.
- Medir e revisar registros `em_andamento` com `started_at` nulo, duplicatas por matrícula/dia operacional e jornadas históricas sem `work_schedule_id`; não corrigir esses dados automaticamente.
- Testar duas sessões concorrentes da mesma matrícula: apenas uma nova visita do dia pode vencer; retry da mesma loja/indústria/data continua idempotente.
- Testar que uma visita antiga não bloqueia um novo check-in do dia após a migration, mas continua intacta e não pode ser finalizada nem alterada pelo promotor.
- Testar DML direto nas quatro tabelas filhas e upload/alteração/exclusão no bucket de fotos; testar leitura preservada pelo promotor dono e revisão por admin/gestor dentro do escopo autorizado.
- Testar fuso, virada de dia, jornada noturna, jornada alterada/versionada, ausência de jornada e timezone padrão.
- Rodar os testes SQL de attendance existentes e adicionar cenários de concorrência/visita antiga em um banco de homologação. A suíte frontend não valida a regra de banco.
- Após revisão e aprovação, aplicar primeiro em homologação; somente então preparar ativação correspondente do frontend para permitir check-ins com pendências antigas.

## Decisão de segurança para esta missão

Não executar migration, alterar Supabase remoto nem habilitar o novo comportamento no frontend. A interface deve continuar informando o bloqueio real até a migration ser revisada, testada em homologação e autorizada. A alteração de frontend desta missão só simplifica o aviso e desativa ações enquanto esse bloqueio existe.
