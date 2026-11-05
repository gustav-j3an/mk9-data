import React from 'react';

interface ConfirmIndustryInactivationModalProps {
  industryName: string;
  industryCode: string;
  activeRoutesCount: number;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmIndustryInactivationModal: React.FC<ConfirmIndustryInactivationModalProps> = ({
  industryName,
  industryCode,
  activeRoutesCount,
  loading,
  onCancel,
  onConfirm
}) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <section
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="inactivate-industry-title"
      className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-2xl space-y-5"
    >
      <div className="flex items-center gap-3 border-b border-[#CFCDC5] pb-4">
        <span className="material-symbols-outlined text-rose-700 text-2xl">block</span>
        <div>
          <h3 id="inactivate-industry-title" className="text-base font-bold text-[#171717]">
            Inativar Indústria e Suspender Rotas?
          </h3>
          <p className="text-xs text-[#5F5F5F]">A indústria e suas escalas ativas serão suspensas da operação.</p>
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-xs space-y-2">
        <div>
          <span className="text-[#5F5F5F]">Indústria: </span>
          <span className="font-bold text-[#171717]">{industryName}</span>
          <span className="text-amber-800 font-mono ml-1.5">({industryCode})</span>
        </div>
        <div className="pt-1 border-t border-[#CFCDC5]/60 flex items-center justify-between">
          <span className="text-[#5F5F5F]">Rotas ativas vinculadas:</span>
          <span className="font-bold font-mono px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-xs">
            {activeRoutesCount} {activeRoutesCount === 1 ? 'rota ativa' : 'rotas ativas'}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950 space-y-1">
        <p className="font-semibold flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[15px]">info</span>
          Regras de Integridade Operacional:
        </p>
        <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-900">
          <li>As {activeRoutesCount} rotas ativas serão suspensas imediatamente das escalas dos promotores.</li>
          <li>Nenhum dado é apagado fisicamente: o histórico de visitas, fotos e auditorias é 100% preservado.</li>
          <li>Rotas que já estavam encerradas antes permanecem inalteradas.</li>
          <li>Se a indústria for reativada no futuro, suas rotas NÃO serão reativadas automaticamente.</li>
        </ul>
      </div>

      <div className="flex justify-end gap-3 border-t border-[#CFCDC5] pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#D5D3CB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold disabled:opacity-50 cursor-pointer"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer"
        >
          <span className="material-symbols-outlined text-sm">block</span>
          {loading ? 'Inativando...' : 'Confirmar Inativação'}
        </button>
      </div>
    </section>
  </div>
);
