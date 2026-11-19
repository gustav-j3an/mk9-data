import React, { useState } from 'react';
import type { Visit } from '../types';
import {
  computeVisitEditDiff,
  validatePromoterEditPermission,
  type VisitAuditChangeRecord
} from '../utils/completedVisitEdit';

interface EditCompletedVisitModalProps {
  visit: Visit;
  currentPromoterMatricula?: string;
  userRole?: string;
  isOpen: boolean;
  onClose: () => void;
  onSaveEdit: (diffRecord: {
    visitId: string;
    sanitizedPayload: any;
    changes: VisitAuditChangeRecord[];
    reason: string;
  }) => Promise<void>;
  onShowToast: (toast: { title: string; message: string; type: 'success' | 'warning' | 'error' | 'info' }) => void;
}

export const EditCompletedVisitModal: React.FC<EditCompletedVisitModalProps> = ({
  visit,
  currentPromoterMatricula,
  userRole,
  isOpen,
  onClose,
  onSaveEdit,
  onShowToast
}) => {
  if (!isOpen) return null;

  const permission = validatePromoterEditPermission(visit, currentPromoterMatricula, userRole);

  const [obsGeral, setObsGeral] = useState(visit.observacao_geral || '');
  const [justificativaAjuste, setJustificativaAjuste] = useState('');
  const [saving, setSaving] = useState(false);

  // Inicializa checklist com cópia dos itens atuais
  const [checklistValues, setChecklistValues] = useState<Record<string, { valor_texto: string; observacao: string }>>(
    () => {
      const initial: Record<string, { valor_texto: string; observacao: string }> = {};
      (visit.checklist_items || []).forEach((item) => {
        initial[item.item_key] = {
          valor_texto: item.valor_texto || '',
          observacao: item.observacao || ''
        };
      });
      return initial;
    }
  );

  if (!permission.canEdit) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-mono">
        <div className="w-full max-w-md p-6 rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-4">
          <div className="flex items-center gap-2 text-rose-800">
            <span className="material-symbols-outlined text-xl">block</span>
            <h3 className="font-bold text-sm">Edição Não Permitida</h3>
          </div>
          <p className="text-xs text-[#5F5F5F] leading-relaxed">
            {permission.reason || 'Esta visita não pode ser editada.'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-xs font-bold text-[#171717] hover:bg-[#E0DED7]"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!justificativaAjuste.trim()) {
      onShowToast({
        title: 'Justificativa Obrigatória',
        message: 'Informe o motivo da correção para registrar na auditoria.',
        type: 'warning'
      });
      return;
    }

    const updatedChecklistItems = (visit.checklist_items || []).map((item) => ({
      item_key: item.item_key,
      item_label: item.item_label,
      checked: item.checked ?? undefined,
      valor_texto: checklistValues[item.item_key]?.valor_texto ?? item.valor_texto ?? '',
      observacao: checklistValues[item.item_key]?.observacao ?? item.observacao ?? ''
    }));

    const diff = computeVisitEditDiff(visit, {
      observacao_geral: obsGeral,
      checklist_items: updatedChecklistItems
    });

    if (!diff.changed) {
      onShowToast({
        title: 'Nenhuma Alteração',
        message: 'Nenhum valor foi modificado nesta visita.',
        type: 'info'
      });
      onClose();
      return;
    }

    setSaving(true);
    try {
      await onSaveEdit({
        visitId: visit.id,
        sanitizedPayload: diff.sanitizedPayload,
        changes: diff.changes,
        reason: justificativaAjuste.trim()
      });
      onShowToast({
        title: 'Atendimento Atualizado',
        message: 'As correções foram salvas e registradas na auditoria com sucesso.',
        type: 'success'
      });
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar correções da visita:', err);
      onShowToast({
        title: 'Falha na Edição',
        message: err.message || 'Erro ao persistir as correções da visita.',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-mono">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-5 shadow-xl text-xs">
        <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
          <div className="space-y-0.5">
            <h3 className="font-bold text-sm text-[#171717] flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-700">edit_note</span>
              Editar Atendimento Concluído
            </h3>
            <p className="text-[11px] text-[#77766F]">
              Loja: <strong className="text-[#171717]">{visit.loja?.nome || visit.loja_codigo}</strong> | Indústria: <strong className="text-[#171717]">{visit.industria?.nome || visit.industria_codigo}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-lg text-[#77766F] hover:bg-[#EAE8E2] cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Informações Imutáveis */}
        <div className="p-3.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-1 text-[11px]">
          <span className="font-bold text-[#5F5F5F] block uppercase">Dados Operacionais Imutáveis (Protegidos)</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[#171717]">
            <div>Data: <strong>{visit.data_visita.split('-').reverse().join('/')}</strong></div>
            <div>Promotor: <strong>{visit.promotor_matricula}</strong></div>
            <div>Início: <strong>{visit.started_at ? new Date(visit.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</strong></div>
            <div>Fim: <strong>{visit.completed_at ? new Date(visit.completed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</strong></div>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Quantidades e Estoque do Checklist */}
          {visit.checklist_items && visit.checklist_items.length > 0 && (
            <div className="space-y-2">
              <label className="font-bold text-[#5F5F5F] block">CONFERÊNCIA DE QUANTIDADES / ESTOQUE</label>
              <div className="space-y-2">
                {visit.checklist_items.map((item) => (
                  <div key={item.item_key} className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                    <span className="font-semibold text-[#171717]">{item.item_label}</span>
                    <div>
                      <input
                        type="text"
                        value={checklistValues[item.item_key]?.valor_texto ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setChecklistValues((prev) => ({
                            ...prev,
                            [item.item_key]: {
                              ...(prev[item.item_key] || { observacao: '' }),
                              valor_texto: val
                            }
                          }));
                        }}
                        placeholder="Quantidade..."
                        className="w-full h-8 px-2 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        value={checklistValues[item.item_key]?.observacao ?? ''}
                        onChange={(e) => {
                          const obs = e.target.value;
                          setChecklistValues((prev) => ({
                            ...prev,
                            [item.item_key]: {
                              ...(prev[item.item_key] || { valor_texto: '' }),
                              observacao: obs
                            }
                          }));
                        }}
                        placeholder="Obs / motivo do ajuste..."
                        className="w-full h-8 px-2 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Observação Geral */}
          <div className="space-y-1">
            <label className="font-bold text-[#5F5F5F] block">OBSERVAÇÕES DA VISITA</label>
            <textarea
              rows={3}
              value={obsGeral}
              onChange={(e) => setObsGeral(e.target.value)}
              placeholder="Descreva detalhes observados nesta loja..."
              className="w-full p-2.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] leading-relaxed"
            />
          </div>

          {/* Justificativa Obrigatória para Auditoria */}
          <div className="space-y-1 pt-2 border-t border-[#CFCDC5]">
            <label className="font-bold text-amber-900 block flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">history_edu</span>
              JUSTIFICATIVA DA CORREÇÃO (REGISTRO OBRIGATÓRIO DE AUDITORIA)
            </label>
            <input
              type="text"
              required
              value={justificativaAjuste}
              onChange={(e) => setJustificativaAjuste(e.target.value)}
              placeholder="Ex: Contagem de depósito retificada após conferência com o gerente..."
              className="w-full h-9 px-3 bg-amber-50 border border-amber-300 rounded-xl text-[#171717] placeholder:text-amber-800/60"
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-3 border-t border-[#CFCDC5]">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 bg-[#EAE8E2] hover:bg-[#E0DED7] text-[#171717] rounded-xl font-bold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-sm ${saving ? 'animate-spin' : ''}`}>
                {saving ? 'sync' : 'save'}
              </span>
              <span>{saving ? 'Gravando auditoria...' : 'Salvar Alterações'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
