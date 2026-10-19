import React, { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmRouteCloseModal } from './ConfirmRouteCloseModal';
import type { RouteItem } from '../types';

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

const testRoute: RouteItem = {
  id: 'route-1',
  codigo_rota: 'R-001',
  industria_codigo: 'IND01',
  loja_codigo: 'LOJA01',
  promotor_matricula: 'ANA01',
  uf: 'SP',
  frequencia: 'SEMANAL',
  segunda: true,
  terca: false,
  quarta: false,
  quinta: false,
  sexta: false,
  sabado: false,
  domingo: false,
  industria: { codigo: 'IND01', nome: 'Indústria Alfa' },
  loja: { codigo: 'LOJA01', nome: 'Loja Central' },
  promotor: { matricula: 'ANA01', nome: 'Ana Leticia' }
};

describe('route closure confirmation modal', () => {
  it('shows the route context and cancellation does not confirm the closure', () => {
    let cancelled = false;
    let confirmed = false;
    const modal = ConfirmRouteCloseModal({
      route: testRoute,
      saving: false,
      onCancel: () => { cancelled = true; },
      onConfirm: () => { confirmed = true; }
    });
    assert.ok(isValidElement<{ children?: ReactNode }>(modal));
    const elements = collectElements(modal);
    const buttons = elements.filter((element) => element.type === 'button');
    const cancelButton = buttons.find((button) => getText(button.props.children).includes('Cancelar'));
    const confirmButton = buttons.find((button) => getText(button.props.children).includes('Confirmar exclusão'));

    assert.ok(getText(modal.props.children).includes('Indústria Alfa'));
    assert.ok(getText(modal.props.children).includes('Loja Central'));
    assert.ok(getText(modal.props.children).includes('Ana Leticia'));
    assert.ok(getText(modal.props.children).includes('SEMANAL'));
    assert.ok(cancelButton?.props.onClick);
    assert.ok(confirmButton?.props.onClick);

    cancelButton.props.onClick({} as React.MouseEvent<HTMLButtonElement>);
    assert.equal(cancelled, true);
    assert.equal(confirmed, false);

    confirmButton.props.onClick({} as React.MouseEvent<HTMLButtonElement>);
    assert.equal(confirmed, true);
  });
});
