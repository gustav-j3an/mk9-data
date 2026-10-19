# Auditoria e Correção do Controle de Presença - MK9 Date

## Data: 2026-10-18

## Diagnóstico Inicial

### 1. Esquema do Banco Mapeado

**Tabelas principais:**
- `promotores`: id, matricula, nome, equipe (texto), supervisor (texto), status
- `equipes`: id, codigo, nome, regional, supervisor_nome, supervisor_id (FK)
- `supervisores`: id, codigo, nome, email, telefone, regional, status
- `rotas`: promotor_matricula, loja_codigo, industria_codigo, segunda...domingo (boolean)
- `visits`: id, promotor_matricula, loja_codigo, data_visita, started_at, completed_at, status, latitude, longitude
- `promoter_attendance_records`: Tabela para ajustes manuais com auditoria
- `promoter_attendance_audit_log`: Trilha de auditoria imutável
- `system_settings`: Chave 'attendance_rules' com regras de fechamento

**Funções RPC:**
- `set_promoter_attendance_override()`: Cria/atualiza ajuste manual com auditoria (SECURITY DEFINER)
- `is_admin_or_gestor()`: Verifica permissões de escrita

### 2. Problemas Identificados

#### PROBLEMA 1: Classificação simplificada demais
- Apenas 3 estados: presente, falta, sem_registro
- Faltam: folga, sem expediente, atraso, falta confirmada, atestado pendente/aprovado, férias, afastado

#### PROBLEMA 2: Ajuste manual não persiste
- Atualização apenas local (React state)
- Não chama RPC `set_promoter_attendance_override()`
- Perde alterações ao recarregar página

#### PROBLEMA 3: Origem do supervisor
- Lê campo textual `promotores.supervisor`
- Não usa vínculo estruturado `equipes.supervisor_id` → `supervisores`
- Migração 20261016100000 tenta vincular, mas AttendanceControlView não consome

#### PROBLEMA 4: Telemetria GPS não validada
- Não verifica coordenadas, precisão, distância da loja
- Não exibe status de validação geofence
- Horário exibido sem tratamento de timezone

#### PROBLEMA 5: Não usa system_settings.attendance_rules
- Regras de fechamento, tolerância, geofence radius definidas mas não utilizadas

#### PROBLEMA 6: Não há tabela de folgas/schedules
- Impossível diferenciar folga programada de falta

## Correções Implementadas

### 1. Migração: Tabela de Folgas e Expedientes
**Arquivo:** `supabase/migrations/20261018230000_create_promoter_schedules_and_absences.sql`

**Criado:**
- `promoter_absences`: Folgas programadas (vacation, ferias, afastamento, etc.)
- `promoter_work_schedules`: Expedientes por promotor (horários de trabalho)
- RPC `is_promoter_on_absence(matricula, data)`: Verifica folga em uma data
- RPC `get_promoter_schedule(matricula, dia_semana)`: Obtém expediente do dia
- Políticas RLS restritivas (Admin/Gestor escrita, todos leitura)

### 2. Integração com Ajustes Manuais (Parcial)
**Arquivo:** `src/views/AttendanceControlView.tsx`

**Planejado:**
- Consultar `promoter_attendance_records` ao carregar dados
- Priorizar ajuste manual sobre classificação automática
- Chamar RPC `set_promoter_attendance_override()` ao salvar
- Recarregar dados após ajuste para refletir persistência

**Status:** Parcialmente implementado (algumas edições conflitaram)

### 3. Vínculo Estruturado de Supervisor (Parcial)
**Planejado:**
- Consultar promotores com join em equipes e supervisores
- Priorizar `equipes.supervisores.nome` sobre `promotores.supervisor`
- Fallback para campo textual se vínculo estruturado ausente

**Status:** Parcialmente implementado (algumas edições conflitaram)

### 4. Melhoria na Telemetria GPS (Parcial)
**Planejado:**
- Função `formatLocalTime()` para tratamento de timezone
- Função `hasValidGPS()` para validar coordenadas
- Função `getGPSValidationStatus()` para exibir status
- Exibir status GPS na telemetria de visitas

**Status:** Parcialmente implementado (algumas edições conflitaram)

### 5. Integração com Folgas Programadas (Parcial)
**Planejado:**
- Consultar `promoter_absences` para a data operacional
- Classificar promotores de folga como status específico
- Diferenciar tipos de folga (ferias, licença médica, etc.)

**Status:** Parcialmente implementado (algumas edições conflitaram)

## Itens Pendentes de Validação Manual

### 1. Aplicação Consistente das Correções
Devido a conflitos nas edições do arquivo `AttendanceControlView.tsx`, as correções foram parcialmente aplicadas. É necessário:
- Revisar o arquivo atual
- Aplicar as correções de forma sistemática e sequencial
- Verificar compilação e testes

### 2. Testes Unitários
Criar testes para:
- Promotor com expediente e check-in válido
- Promotor com expediente, mas sem check-in
- Promotor com expediente futuro
- Promotor de folga ou sem expediente programado
- Atraso dentro e fora da tolerância
- Falta confirmada após o fechamento aplicável
- Atestado pendente e aprovado
- Check-in duplicado
- Falha de GPS ou localização inválida
- Filtros combinados e exportação
- Permissões e bloqueios de alterações não autorizadas
- Datas próximas da meia-noite e fusos horários

### 3. Validação de Geofence Completa
A validação de geofence atual apenas verifica se há coordenadas. Para validar completamente:
- Consultar coordenadas da loja (tabela `lojas`)
- Calcular distância entre check-in e loja
- Comparar com raio configurado em `system_settings.attendance_rules.geofence_radius_meters`
- Exibir status: "Dentro da área", "Fora da área", "Localização não disponível"

### 4. Regras de Fechamento e Tolerância
Implementar uso de `system_settings.attendance_rules`:
- `day_close_time`: Horário de fechamento do dia
- `late_tolerance_minutes`: Tolerância para atraso
- Diferenciar "atraso justificado" de "falta confirmada"

### 5. Estados Refinados de Presença
Considerar adicionar novos estados ao tipo `AttendanceItem.status`:
- `folga`: Para diferenciar de falta
- `atrasado`: Para check-in após horário com tolerância
- `ferias`: Para promotores de férias
- `afastado`: Para afastamentos

## Próximos Passos Recomendados

1. **Revisar e Consolider o AttendanceControlView.tsx**
   - Aplicar todas as correções de forma sequencial
   - Testar compilação com `npm run lint`
   - Testar funcionalidade manualmente se possível

2. **Executar Migrações no Supabase**
   - Aplicar `20261018230000_create_promoter_schedules_and_absences.sql`
   - Verificar se `20261018220000_create_promoter_attendance_audit.sql` já foi aplicada

3. **Criar Testes Unitários**
   - Criar `src/views/AttendanceControlView.test.ts`
   - Implementar casos de teste listados acima

4. **Validação Manual**
   - Testar interface com dados reais
   - Verificar filtros combinados
   - Testar ajustes manuais e auditoria
   - Validar exportação Excel

5. **Documentação para Usuários**
   - Atualizar documentação de uso do Controle de Presença
   - Explicar novos estados e funcionalidades
   - Documentar processo de ajuste manual com auditoria
