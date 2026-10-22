import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./IndustriesView.tsx', import.meta.url), 'utf8');

describe('Cadastro de indústrias compatível com o schema atual', () => {
  it('criação usa payload sem a coluna opcional de grupo', () => {
    assert.match(source, /\.insert\(\[payload\]\)/);
    assert.doesNotMatch(source, /whatsapp_group_link/);
  });

  it('edição usa payload sem a coluna opcional de grupo', () => {
    assert.match(source, /\.update\(payload\)/);
    assert.doesNotMatch(source, /whatsapp_group_link/);
  });
});
