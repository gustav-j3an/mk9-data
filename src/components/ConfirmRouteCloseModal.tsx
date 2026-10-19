import React from 'react';
import type { RouteItem } from '../types';

interface ConfirmRouteCloseModalProps {
  route: RouteItem;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmRouteCloseModal: React.FC<ConfirmRouteCloseModalProps> = ({
  route,
  saving,
  onCancel,
  onConfirm
}) => (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <section
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="close-route-title"
      className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5"
    >
      <div className="flex items-center gap-3 border-b border-[#CFCDC5] pb-4">
        <span className="material-symbols-outlined text-rose-700 text-2xl">delete</span>
        <div>
          <h3 id="close-route-title" className="text-base font-bold text-[#171717]">
            Encerrar escala fixa?
          </h3>
          <p className="text-xs text-[#5F5F5F]">A escala deixará de ser ativa nos módulos operacionais.</p>
        </div>
      </div>

      <dl className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-xs space-y-1.5">
        <div><dt className="inline text-[#5F5F5F]">Indústria: </dt><dd className="inline font-bold text-[#171717]">{route.industria?.nome || route.industria_codigo}</dd></div>
        <div><dt className="inline text-[#5F5F5F]">Loja: </dt><dd className="inline font-bold text-[#171717]">{route.loja?.nome || route.loja_codigo}</dd></div>
        <div><dt className="inline text-[#5F5F5F]">Promotor: </dt><dd className="inline font-bold text-[#171717]">{route.promotor?.nome || route.promotor_matricula}</dd></div>
        <div><dt className="inline text-[#5F5F5F]">Frequência: </dt><dd className="inline font-bold text-[#171717]">{route.frequencia || 'SEMANAL'}</dd></div>
      </dl>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
        Novos agendamentos não serão gerados por esta escala. Visitas já registradas, fotos, check-ins,
        check-outs, conferências, aprovações e auditorias serão preservados sem alteração.
      </div>

      <div className="flex justify-end gap-3 border-t border-[#CFCDC5] pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#D5D3CB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-sm">delete</span>
          {saving ? 'Encerrando...' : 'Confirmar exclusão'}
        </button>
      </div>
    </section>
  </div>
);
