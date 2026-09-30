import React from 'react';
import { ToastMessage } from '../types';

interface DesignSystemViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const DesignSystemView: React.FC<DesignSystemViewProps> = ({ onShowToast }) => {
  const copyColor = (hex: string, label: string) => {
    navigator.clipboard?.writeText(hex);
    onShowToast({
      title: 'Token Copiado',
      message: `${label} (${hex}) copiado para a área de transferência.`,
      type: 'success'
    });
  };

  const colorPalettes = [
    {
      group: 'Canvas & Surface Depth',
      colors: [
        { label: 'Surface Dim', hex: '#0a0d14', desc: 'Canvas Base Mais Escuro' },
        { label: 'Surface Base', hex: '#0f131d', desc: 'Viewport Principal' },
        { label: 'Surface Container Low', hex: '#131722', desc: 'Fundo de Inputs & Wells' },
        { label: 'Surface Container', hex: '#171b26', desc: 'Cards Operacionais HUD' },
        { label: 'Surface Container High', hex: '#1f2433', desc: 'Hover & Destaques' },
        { label: 'Border Dark', hex: '#1e2433', desc: 'Divisões Estruturais' }
      ]
    },
    {
      group: 'Spectral Accent Scales',
      colors: [
        { label: 'Primary Neon Violet', hex: '#9333ea', desc: 'Ações Primárias & Foco' },
        { label: 'Primary Tint', hex: '#ddb8ff', desc: 'Textos & Ícones Violeta' },
        { label: 'Secondary Neon Cyan', hex: '#00a2e6', desc: 'Telemetria & Rastreamento' },
        { label: 'Secondary Tint', hex: '#89ceff', desc: 'Realces de Rotas & PDVs' },
        { label: 'Tertiary Emerald', hex: '#4edea3', desc: 'Status Ao Vivo & Presença' },
        { label: 'Status Amber', hex: '#f59e0b', desc: 'Atenção & Janelas' },
        { label: 'Status Rose Danger', hex: '#f43f5e', desc: 'Rupturas & Alertas Críticos' }
      ]
    }
  ];

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-8 font-sans">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2433] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(147,51,234,0.6)]">
              <span className="text-xs tracking-wider font-extrabold font-mono">MK</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Logo &amp; Design System
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Identidade visual corporativa, escala tipográfica, tokens de cor e componentes de interface do <strong>MK9 Command Center — Trade Marketing Operations</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full bg-purple-600/20 text-purple-300 border border-purple-500/30 text-xs font-mono font-bold">
            Guia de Estilo Ativo v2.5
          </span>
        </div>
      </section>

      {/* Brand Identity & Logo Showcase */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500" />
          1. Identidade de Marca (Logos &amp; Lockups)
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Lockup Principal */}
          <div className="bg-[#171b26] border border-[#1e2433] p-6 rounded-xl flex flex-col justify-between items-center text-center space-y-4 shadow-lg">
            <span className="text-xs font-mono text-slate-400">Lockup Principal Horizontal</span>
            <div className="flex items-center gap-3 p-4 bg-[#0a0d14] rounded-xl border border-[#1e2433] shadow-inner">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_16px_rgba(147,51,234,0.6)]">
                <span className="text-sm font-extrabold font-mono">MK</span>
              </div>
              <div className="flex flex-col text-left">
                <span className="text-base font-extrabold text-white tracking-wide uppercase leading-tight">
                  MK9 COMMAND
                </span>
                <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-widest font-mono">
                  TRADE MARKETING OPS
                </span>
              </div>
            </div>
            <span className="text-[11px] text-slate-500">Usado na sidebar, cabeçalhos e relatórios</span>
          </div>

          {/* Símbolo Isolado */}
          <div className="bg-[#171b26] border border-[#1e2433] p-6 rounded-xl flex flex-col justify-between items-center text-center space-y-4 shadow-lg">
            <span className="text-xs font-mono text-slate-400">Símbolo Ícone de App</span>
            <div className="relative group">
              <div className="w-20 h-20 rounded-2xl bg-[#0a0d14] border border-purple-500/40 p-2 flex items-center justify-center shadow-[0_0_30px_rgba(147,51,234,0.35)]">
                <div className="w-full h-full rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-400 flex items-center justify-center font-extrabold text-white text-2xl font-mono">
                  MK
                </div>
              </div>
            </div>
            <span className="text-[11px] text-slate-500">Favicon, app mobile e telemetry pins</span>
          </div>

          {/* Lockup Compacto */}
          <div className="bg-[#171b26] border border-[#1e2433] p-6 rounded-xl flex flex-col justify-between items-center text-center space-y-4 shadow-lg">
            <span className="text-xs font-mono text-slate-400">Badge de Sistema</span>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0a0d14] border border-cyan-500/30 shadow-md">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 neon-green-glow" />
              <span className="font-mono text-xs font-bold text-white">MK9 CORE • 99.1% ATIVO</span>
            </div>
            <span className="text-[11px] text-slate-500">Status bar do cockpit e telemetria</span>
          </div>
        </div>
      </section>

      {/* Colors & Tokens */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          2. Paleta de Cores &amp; Tokens Táticos
        </h2>

        <div className="space-y-6">
          {colorPalettes.map((palette) => (
            <div key={palette.group} className="space-y-3">
              <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
                {palette.group}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {palette.colors.map((c) => (
                  <div
                    key={c.hex}
                    onClick={() => copyColor(c.hex, c.label)}
                    className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-slate-500 p-3 rounded-xl shadow-md transition-all group flex flex-col justify-between"
                  >
                    <div
                      className="w-full h-14 rounded-lg mb-2 shadow-inner border border-white/5 flex items-end justify-end p-1.5"
                      style={{ backgroundColor: c.hex }}
                    >
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white rounded p-0.5">
                        <span className="material-symbols-outlined text-xs">content_copy</span>
                      </span>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white leading-tight">{c.label}</div>
                      <div className="font-mono text-[10px] text-cyan-400 mt-0.5">{c.hex}</div>
                      <div className="text-[9px] text-slate-500 mt-1 leading-tight">{c.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Typography Scale */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          3. Escala Tipográfica (Plus Jakarta Sans &amp; JetBrains Mono)
        </h2>

        <div className="bg-[#171b26] border border-[#1e2433] rounded-xl p-6 shadow-xl space-y-4">
          <div className="space-y-3 divide-y divide-[#1e2433]">
            <div className="pt-2">
              <span className="text-[10px] uppercase font-mono text-purple-400">Display-LG • 36px ExtraBold</span>
              <div className="text-3xl font-extrabold text-white tracking-tight mt-1">
                Cockpit Operacional MK9
              </div>
            </div>
            <div className="pt-3">
              <span className="text-[10px] uppercase font-mono text-purple-400">Headline-XL • 28px Bold</span>
              <div className="text-2xl font-bold text-white tracking-tight mt-1">
                Painel Operacional de Trade Marketing
              </div>
            </div>
            <div className="pt-3">
              <span className="text-[10px] uppercase font-mono text-purple-400">KPI Metric • 32px Tabular Numerals (JetBrains Mono / Plus Jakarta)</span>
              <div className="text-3xl font-extrabold text-white font-mono mt-1 flex items-baseline gap-3">
                <span>R$ 238.053,60</span>
                <span className="text-emerald-400 text-sm font-bold">+14 este mês</span>
                <span className="text-cyan-300 text-sm">99.1% Ativa</span>
              </div>
            </div>
            <div className="pt-3">
              <span className="text-[10px] uppercase font-mono text-purple-400">Body-MD • 13px Regular</span>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-3xl leading-relaxed">
                Acompanhamento em tempo real de promotores de campo, cumprimento de rotas, índice de ruptura e conformidade de gôndola em 4.820 PDVs de redes estratégicas brasileiras.
              </p>
            </div>
            <div className="pt-3">
              <span className="text-[10px] uppercase font-mono text-purple-400">Label-Mono • 11px JetBrains Mono</span>
              <div className="font-mono text-xs text-cyan-400 mt-1">
                MAT-84920 • CPF: ***.418.092-** • GEOFENCE 412M OK • STATUS: 200 OK
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Component Library Showcase */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          4. Biblioteca de Componentes Táticos
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Botões */}
          <div className="bg-[#171b26] border border-[#1e2433] rounded-xl p-5 shadow-lg space-y-4">
            <span className="text-xs font-mono font-bold text-slate-400 uppercase">Botões &amp; Ações</span>
            <div className="flex flex-wrap items-center gap-3">
              <button className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs neon-purple-glow">
                + Novo freelancer
              </button>
              <button className="px-4 py-2 rounded-lg bg-[#171b26] hover:bg-[#1f2433] text-slate-200 border border-[#1e2433] text-xs font-semibold">
                Exportar Base
              </button>
              <button className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs neon-cyan-glow">
                Transferir Squad
              </button>
              <button className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs">
                Disparar Reposição
              </button>
            </div>
          </div>

          {/* Badges de Status */}
          <div className="bg-[#171b26] border border-[#1e2433] rounded-xl p-5 shadow-lg space-y-4">
            <span className="text-xs font-mono font-bold text-slate-400 uppercase">Badges de Telemetria</span>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ATIVO / CONFORME
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                A PAGAR / JANELA
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                RUPTURA CRÍTICA
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                PONTO EXTRA VALIDADO
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                INATIVO
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
