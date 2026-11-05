import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmIndustryRegularizationModal } from './ConfirmIndustryRegularizationModal';

describe('ConfirmIndustryRegularizationModal', () => {
  it('exporta o componente de modal para regularização de rotas de indústria inativa', () => {
    assert.equal(typeof ConfirmIndustryRegularizationModal, 'function');
  });
});
