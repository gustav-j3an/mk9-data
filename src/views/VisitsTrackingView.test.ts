import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Acompanhamento pagina resultados já filtrados e volta ao início quando os filtros mudam', async () => {
  const source = await readFile(new URL('./VisitsTrackingView.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState\<VisitPageSize\>\(15\)/);
  assert.match(source, /paginateVisits\(orderedFilteredVisits, visitPage, visitPageSize\)/);
  assert.match(source, /\{visibleVisits\.map\(\(item\) =>/);
  assert.match(source, /setVisitPage\(1\), \[/);
  assert.match(source, /value=\{15\}/);
  assert.match(source, /value=\{25\}/);
  assert.match(source, /value=\{50\}/);
  assert.match(source, /aria-label="Paginação das visitas"/);
  assert.match(source, />Anterior<\/button>/);
  assert.match(source, />Próxima<\/button>/);
  assert.match(source, /Ver Detalhes/);
});

test('indicadores permanecem acionáveis e os painéis recolhíveis começam fechados', async () => {
  const source = await readFile(new URL('./VisitsTrackingView.tsx', import.meta.url), 'utf8');
  assert.match(source, /toggleStatusIndicator\('em_andamento'\)/);
  assert.match(source, /toggleStatusIndicator\('concluida'\)/);
  assert.match(source, /toggleStatusIndicator\('pendente'\)/);
  assert.match(source, /toggleOccurrenceIndicator/);
  assert.match(source, /toggleStatusIndicator\('administratively_completed'\)/);
  assert.match(source, /toggleStatusIndicator\('closed_without_proof'\)/);
  assert.match(source, /<details className="bg-white rounded-2xl border border-amber-300/);
  assert.match(source, /<details className="bg-white rounded-2xl border border-\[#E4E2DB\]/);
  assert.match(source, /Buscar promotor pelo nome/);
  assert.match(source, /Somente com pendências/);
  assert.match(source, /REGULARIZAR VISITA/);
});
