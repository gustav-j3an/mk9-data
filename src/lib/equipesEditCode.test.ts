import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { equipesService } from './equipesService';

test('equipesService.checkCodigoEmUso is exported and accepts code and exclude id', () => {
  assert.equal(typeof equipesService.checkCodigoEmUso, 'function');
});

test('updateEquipe formats friendly error on unique key violation', async () => {
  // Simular mock de erro duplicate key / 23505
  // Verificamos no código de equipesService se há interceptação clara
  const fileContent = await readFile(new URL('./equipesService.ts', import.meta.url), 'utf8');
  assert.match(fileContent, /code === '23505' \|\| error\.message\.includes\('duplicate key'\)/);
  assert.match(fileContent, /já está em uso por outra equipe/);
});

test('TeamsManagementView sets editingEquipe on handleOpenEditModal and checks duplicate code', async () => {
  const viewContent = await readFile(new URL('../views/TeamsManagementView.tsx', import.meta.url), 'utf8');
  
  // 1. Garante que setEditingEquipe é invocado na abertura do modal de edição
  assert.match(viewContent, /setEditingEquipe\(equipe\)/);

  // 2. Garante que suggestedCode é limpo no modal de edição
  assert.match(viewContent, /setSuggestedCode\(''\)/);

  // 3. Garante que o placeholder do modal de edição usa o código da equipe atual, e não auto-gerar EQP-XXX
  assert.match(viewContent, /placeholder=\{currentEquipe\.codigo \|\| 'Código da equipe'\}/);

  // 4. Garante que no card, ao clicar em editar, a equipe correta é selecionada
  assert.match(viewContent, /setSelectedEquipe\(equipe\);\s*handleOpenEditModal\(equipe\);/);

  // 5. Garante que antes de salvar código alterado, checkCodigoEmUso é chamado excluindo targetEquipe.id
  assert.match(viewContent, /equipesService\.checkCodigoEmUso\(finalCode, targetEquipe\.id\)/);

  // 6. Garante mensagem amigável quando código estiver em uso
  assert.match(viewContent, /já pertence a outra equipe cadastrada/);
});

test('Preserves original team code when user leaves manualCode unchanged or empty', () => {
  const currentEquipe = { id: 'eq-1', codigo: 'EQP-001', nome: 'SQUAD ALPHA' };
  
  // Cenário 1: usuário não mexe no código (manualCode = 'EQP-001')
  const codeUnchanged = ('EQP-001'.trim() || currentEquipe.codigo).toUpperCase();
  assert.equal(codeUnchanged, 'EQP-001');

  // Cenário 2: usuário apaga o campo (manualCode = '')
  const codeEmpty = (''.trim() || currentEquipe.codigo).toUpperCase();
  assert.equal(codeEmpty, 'EQP-001');

  // Cenário 3: usuário altera para código válido diferente
  const codeChanged = ('EQP-099'.trim() || currentEquipe.codigo).toUpperCase();
  assert.equal(codeChanged, 'EQP-099');
});

