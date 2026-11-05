import React from 'react';

interface ConfirmIndustryRegularizationModalProps {
  industryName: string;
  industryCode: string;
  activeRoutesCount: number;
  promotoresCount: number;
  storesCount: number;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmIndustryRegularizationModal: React.FC<ConfirmIndustryRegularizationModalProps> = ({
  industryName,
  industryCode,
  activeRoutesCount,
  promotoresCount,
  storesCount,
  loading,
  onConfirm,
  onCancel
}) => {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="regularize-industry-title"
        aria-describedby="regularize-industry-description"
        className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-center gap-3 border-b border-[#CFCDC5] pb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-200 text-amber-800 flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl">sync_problem</span>
          </div>
          <div>
            <h3 id="regularize-industry-title" className="text-base font-bold text-[#171717] font-mono">
              Regularizar Escalas da Indústria
            </h3>
            <p className="text-xs text-[#5F5F5F]">
              Sincronização de rotas ativas remanescentes de indústria inativa
            </p>
          </div>
        </div>

        <p id="regularize-industry-description" className="text-xs text-[#333333] leading-relaxed">
          A indústria <strong className="text-[#171717]">{industryName}</strong> ({industryCode}) já se encontra <span className="font-bold text-rose-700">INATIVA</span>, porém ainda constam <strong className="text-[#171717] font-mono">{activeRoutesCount}</strong> {activeRoutesCount === 1 ? 'escala ativa' : 'escalas ativas'} vinculadas a ela.
        </p>

        <div className="grid grid-cols-3 gap-2.5 text-center text-xs font-mono">
          <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl">
            <span className="text-[10px] text-[#5F5F5F] block uppercase font-bold">Rotas Ativas</span>
            <span className="text-sm font-extrabold text-amber-900">{activeRoutesCount}</span>
          </div>
          <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl">
            <span className="text-[10px] text-[#5F5F5F] block uppercase font-bold">Promotores</span>
            <span className="text-sm font-extrabold text-[#171717]">{promotoresCount}</span>
          </div>
          <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl">
            <span className="text-[10px] text-[#5F5F5F] block uppercase font-bold">Lojas</span>
            <span className="text-sm font-extrabold text-[#171717]">{storesCount}</span>
          </div>
        </div>

        <div className="rounded-xl border border-amber-300 bg-amber-500/10 p-3.5 space-y-1.5 text-xs text-amber-950">
          <div className="font-bold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-amber-700">verified_user</span>
            Preservação e Atomicidade no Banco de Dados
          </div>
          <p className="leading-relaxed">
            As escalas serão suspensas via transação PostgreSQL no banco com motivo rastreável. Visitas concluídas, históricos, fotos, evidências e auditorias passadas são integralmente preservados.
          </p>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#CFCDC5] pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#D5D3CB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold disabled:opacity-50 cursor-pointer transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer transition-all shadow-sm active:scale-95"
          >
            <span className="material-symbols-outlined text-sm">build_circle</span>
            {loading ? 'Regularizando...' : 'Confirmar Regularização'}
          </button>
        </div>
      </section>
    </div>
  );
};
