import type { Visit, VisitChecklistItem, VisitPhoto, VisitOccurrence, VisitProductValidity } from '../types';

export interface EditableVisitFields {
  observacao_geral?: string;
  checklist_items?: Array<{
    item_key: string;
    item_label?: string;
    checked?: boolean;
    valor_texto?: string;
    observacao?: string;
  }>;
  validity_items?: Array<{
    id?: string;
    produto_nome: string;
    quantidade: number;
    data_vencimento: string;
    lote?: string;
  }>;
}

export interface VisitAuditChangeRecord {
  field: string;
  oldValue: any;
  newValue: any;
}

export interface VisitEditDiff {
  changed: boolean;
  changes: VisitAuditChangeRecord[];
  sanitizedPayload: {
    observacao_geral: string;
    checklist_items: Array<{
      item_key: string;
      item_label: string;
      checked: boolean;
      valor_texto: string;
      observacao: string;
    }>;
    validity_items: Array<{
      id?: string;
      produto_nome: string;
      quantidade: number;
      data_vencimento: string;
      lote: string;
    }>;
  };
}

export interface PromoterVisitPermission {
  canEdit: boolean;
  reason?: string;
}

/**
 * Regra de segurança: O promotor só pode editar visitas que ele mesmo realizou,
 * preservando integridade de promotor_matricula, loja_codigo, industria_codigo e timestamps de check-in/out.
 */
export const validatePromoterEditPermission = (
  visit: Visit,
  currentPromoterMatricula?: string,
  userRole?: string
): PromoterVisitPermission => {
  if (!currentPromoterMatricula && userRole !== 'admin' && userRole !== 'gestor') {
    return { canEdit: false, reason: 'Usuário não autenticado ou sem matrícula vinculada.' };
  }

  const isStaff = userRole === 'admin' || userRole === 'gestor';
  if (!isStaff && visit.promotor_matricula !== currentPromoterMatricula) {
    return { canEdit: false, reason: 'Você só pode editar visitas realizadas por você mesmo.' };
  }

  // Visita precisa estar concluída para este fluxo de pós-atendimento
  if (visit.status !== 'concluida') {
    return { canEdit: false, reason: 'Apenas visitas concluídas podem ter seus dados revisados neste fluxo.' };
  }

  return { canEdit: true };
};

/**
 * Computa o diff auditável para garantir que nenhum dado sensível ou identificador estrutural
 * (loja, indústria, matrícula, started_at, completed_at) seja modificado.
 */
export const computeVisitEditDiff = (
  originalVisit: Visit,
  updatedFields: EditableVisitFields
): VisitEditDiff => {
  const changes: VisitAuditChangeRecord[] = [];

  // 1. Observação Geral
  const oldObs = (originalVisit.observacao_geral || '').trim();
  const newObs = (updatedFields.observacao_geral !== undefined ? updatedFields.observacao_geral : oldObs).trim();
  if (oldObs !== newObs) {
    changes.push({
      field: 'observacao_geral',
      oldValue: oldObs,
      newValue: newObs
    });
  }

  // 2. Checklist / Quantidades
  const originalChecklist = originalVisit.checklist_items || [];
  const updatedChecklist = updatedFields.checklist_items || [];
  const sanitizedChecklist: VisitEditDiff['sanitizedPayload']['checklist_items'] = [];

  for (const item of updatedChecklist) {
    const existing = originalChecklist.find((orig) => orig.item_key === item.item_key);
    const checked = item.checked ?? existing?.checked ?? false;
    const valor_texto = (item.valor_texto !== undefined ? item.valor_texto : existing?.valor_texto || '').trim();
    const observacao = (item.observacao !== undefined ? item.observacao : existing?.observacao || '').trim();
    const item_label = item.item_label || existing?.item_label || item.item_key;

    if (
      existing &&
      (existing.checked !== checked ||
        (existing.valor_texto || '').trim() !== valor_texto ||
        (existing.observacao || '').trim() !== observacao)
    ) {
      changes.push({
        field: `checklist.${item.item_key}`,
        oldValue: {
          checked: existing.checked,
          valor_texto: (existing.valor_texto || '').trim(),
          observacao: (existing.observacao || '').trim()
        },
        newValue: { checked, valor_texto, observacao }
      });
    } else if (!existing) {
      changes.push({
        field: `checklist.${item.item_key}`,
        oldValue: null,
        newValue: { checked, valor_texto, observacao }
      });
    }

    sanitizedChecklist.push({
      item_key: item.item_key,
      item_label,
      checked,
      valor_texto,
      observacao
    });
  }

  // 3. Validades / SKUs
  const originalValidity = originalVisit.validity_items || [];
  const updatedValidity = updatedFields.validity_items || [];
  const sanitizedValidity: VisitEditDiff['sanitizedPayload']['validity_items'] = [];

  for (const vItem of updatedValidity) {
    const orig = vItem.id ? originalValidity.find((o) => o.id === vItem.id) : undefined;
    const nome = vItem.produto_nome.trim();
    const qtd = Number(vItem.quantidade) || 0;
    const venc = vItem.data_vencimento;
    const lote = (vItem.lote || '').trim();

    if (orig) {
      if (
        orig.produto_nome !== nome ||
        orig.quantidade !== qtd ||
        orig.data_vencimento !== venc ||
        (orig.lote || '').trim() !== lote
      ) {
        changes.push({
          field: `validity.${orig.id}`,
          oldValue: { produto_nome: orig.produto_nome, quantidade: orig.quantidade, data_vencimento: orig.data_vencimento, lote: orig.lote || '' },
          newValue: { produto_nome: nome, quantidade: qtd, data_vencimento: venc, lote }
        });
      }
    } else {
      changes.push({
        field: `validity.new_${nome}`,
        oldValue: null,
        newValue: { produto_nome: nome, quantidade: qtd, data_vencimento: venc, lote }
      });
    }

    sanitizedValidity.push({
      id: vItem.id,
      produto_nome: nome,
      quantidade: qtd,
      data_vencimento: venc,
      lote
    });
  }

  return {
    changed: changes.length > 0,
    changes,
    sanitizedPayload: {
      observacao_geral: newObs,
      checklist_items: sanitizedChecklist,
      validity_items: sanitizedValidity
    }
  };
};
