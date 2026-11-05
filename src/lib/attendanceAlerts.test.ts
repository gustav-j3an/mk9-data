import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const view = readFileSync('src/views/AttendanceControlView.tsx', 'utf8');
const service = readFileSync('src/lib/attendanceService.ts', 'utf8');
test('presence exposes filtered pending lists and team correction without journey editing', () => {
 assert.ok(view.includes('pending.supervisors.map'));
 assert.ok(view.includes("onNavigate('gestao-equipes')"));
 assert.ok(view.includes('pending.journeys.map'));
 assert.ok(view.includes('onClick={handleExport}'));
 assert.ok(!view.includes('AttendanceJourneyPanel'));
 assert.ok(!view.includes('setShowConfig'));
});
test('suspended absence activation warnings are absent and missing schedules are not counted as known gaps', () => {
 assert.ok(!service.includes('Faltas automáticas desabilitadas:'));
 assert.ok(service.includes("missing.includes('promoter_work_schedules') ? []"));
 assert.ok(service.includes('o.scheduledVisitsCount > 0'));
 assert.ok(service.includes("i.operationalStatus === 'sem_expediente'"));
 assert.ok(service.includes("q => q.eq('status', 'ativo')"));
});
