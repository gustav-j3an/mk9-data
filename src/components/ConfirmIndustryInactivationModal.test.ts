import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React, { isValidElement, type ReactElement, type ReactNode } from 'react';
import { ConfirmIndustryInactivationModal } from './ConfirmIndustryInactivationModal';

type ElementWithChildren = ReactElement<{
  children?: ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}>;

const collectElements = (node: ReactNode): ElementWithChildren[] => {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (!isValidElement<{ children?: ReactNode; onClick?: React.MouseEventHandler<HTMLButtonElement> }>(node)) {
    return [];
  }
  return [node, ...collectElements(node.props.children)];
};

const getText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return getText(node.props.children);
  return '';
};

describe('ConfirmIndustryInactivationModal', () => {
  it('renderiza o modal com o nome da indústria e a contagem real de rotas ativas afetadas', () => {
    let cancelled = false;
    let confirmed = false;

    const modal = ConfirmIndustryInactivationModal({
      industryName: 'COPRA ALIMENTOS',
      industryCode: 'IND-007',
      activeRoutesCount: 8,
      loading: false,
      onCancel: () => { cancelled = true; },
      onConfirm: () => { confirmed = true; }
    });

    assert.ok(isValidElement<{ children?: ReactNode }>(modal));
    const fullText = getText(modal.props.children);

    assert.ok(fullText.includes('COPRA ALIMENTOS'));
    assert.ok(fullText.includes('IND-007'));
    assert.ok(fullText.includes('8 rotas ativas'));

    const elements = collectElements(modal);
    const buttons = elements.filter((el) => el.type === 'button');
    const cancelButton = buttons.find((btn) => getText(btn.props.children).includes('Cancelar'));
    const confirmButton = buttons.find((btn) => getText(btn.props.children).includes('Confirmar Inativação'));

    assert.ok(cancelButton);
    assert.ok(confirmButton);

    cancelButton.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
    assert.equal(cancelled, true);
    assert.equal(confirmed, false);

    confirmButton.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
    assert.equal(confirmed, true);
  });
});
