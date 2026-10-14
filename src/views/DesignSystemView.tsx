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
      group: 'ArtCraft / GridCraft Light Surfaces',
      colors: [
        { label: 'Fundo Principal', hex: '#EAE8E2', desc: 'Canvas do App & Viewport' },
        { label: 'Superfície & Cartões', hex: '#F7F6F2', desc: 'Cards, Modais & Sidebar' },
        { label: 'Fundo Secundário', hex: '#E4E2DB', desc: 'Inputs, Tabs & Cabeçalhos' },
        { label: 'Texto Principal', hex: '#171717', desc: 'Títulos & Conteúdo Primário' },
        { label: 'Texto Secundário', hex: '#737373', desc: 'Labels, Datas & Legendas' },
        { label: 'Bordas & Divisórias', hex: '#CFCDC5', desc: 'Linhas Finas Estruturais' }
      ]
    },
    {
      group: 'Botões & Acentos Institucionais',
      colors: [
        { label: 'Botão Primário', hex: '#111114', desc: 'Ações Primárias & CTAs' },
        { label: 'Azul Institucional MK9', hex: '#286FF5', desc: 'Destaques & Realces' },
        { label: 'Verde Sucesso', hex: '#16845B', desc: 'Check-ins Concluídos' },
        { label: 'Âmbar Atenção', hex: '#D98A00', desc: 'Pendências & Alertas' },
        { label: 'Vermelho Erro / Ruptura', hex: '#D93636', desc: 'Rupturas & Atrasos' },
        { label: 'Texto Botões Primários', hex: '#FFFFFF', desc: 'Contraste em Botões Pretos' }
      ]
    }
  ];

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-8 font-sans">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#CFCDC5] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-extrabold tracking-tight text-[#171717]">MK9</span>
            <span className="text-xs font-bold text-[#286FF5] tracking-widest font-mono uppercase bg-[#EBF2FE] px-2 py-0.5 rounded border border-[#C3D9FD]">
              DATE
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-[#171717] tracking-tight mt-1">
            Design System &amp; Identidade Visual ArtCraft / GridCraft
          </h1>
          <p className="text-xs sm:text-sm text-[#737373] mt-1 max-w-3xl">
            Tokens de cor, escala tipográfica e componentes de interface do <strong>MK9 Date — Trade Marketing Operations</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-mono font-bold">
            Diretriz ArtCraft v2.5
          </span>
        </div>
      </section>

      {/* Brand Identity & Logo Showcase */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#111114]" />
          1. Identidade de Marca (Logos &amp; Lockups)
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Lockup Principal */}
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] p-6 rounded-xl flex flex-col justify-between items-center text-center space-y-4 shadow-xs">
            <span className="text-xs font-mono text-[#737373]">Lockup Principal Horizontal</span>
            <div className="flex items-center gap-3 p-4 bg-[#EAE8E2] rounded-xl border border-[#CFCDC5]">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-[#171717]">MK9</span>
                <span className="text-xs font-bold text-[#286FF5] tracking-widest font-mono uppercase bg-[#EBF2FE] px-2 py-0.5 rounded border border-[#C3D9FD]">
                  DATE
                </span>
              </div>
              <div className="h-6 w-px bg-[#CFCDC5]" />
              <div className="text-left font-mono text-[10px] text-[#737373] font-bold tracking-wider uppercase leading-tight">
                TRADE MARKETING<br />OPERATIONS
              </div>
            </div>
            <span className="text-[11px] text-[#737373]">Usado na sidebar, cabeçalhos e relatórios executivos</span>
          </div>

          {/* Símbolo Isolado */}
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] p-6 rounded-xl flex flex-col justify-between items-center text-center space-y-4 shadow-xs">
            <span className="text-xs font-mono text-[#737373]">Símbolo / Ícone de App</span>
            <div className="relative group">
              <div className="w-16 h-16 rounded-xl bg-[#111114] border border-[#CFCDC5] flex items-center justify-center text-white font-extrabold text-xl font-mono shadow-xs">
                MK9
              </div>
            </div>
            <span className="text-[11px] text-[#737373]">Favicon, ícone PWA mobile e pins</span>
          </div>

          {/* Lockup Compacto */}
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] p-6 rounded-xl flex flex-col justify-between items-center text-center space-y-4 shadow-xs">
            <span className="text-xs font-mono text-[#737373]">Badge de Telemetria</span>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-[#CFCDC5]">
              <span className="w-2 h-2 rounded-full bg-[#16845B]" />
              <span className="font-mono text-xs font-bold text-[#171717]">MK9 DATE • OPERAÇÃO ATIVA</span>
            </div>
            <span className="text-[11px] text-[#737373]">Status bar do cockpit e rodapés</span>
          </div>
        </div>
      </section>

      {/* Colors & Tokens */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#286FF5]" />
          2. Paleta de Cores &amp; Tokens de Design
        </h2>

        <div className="space-y-6">
          {colorPalettes.map((palette) => (
            <div key={palette.group} className="space-y-3">
              <h3 className="text-xs font-mono font-bold text-[#737373] uppercase tracking-wider">
                {palette.group}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {palette.colors.map((c) => (
                  <div
                    key={c.hex}
                    onClick={() => copyColor(c.hex, c.label)}
                    className="cursor-pointer bg-[#F7F6F2] border border-[#CFCDC5] hover:border-[#111114] p-3 rounded-xl transition-all group flex flex-col justify-between"
                  >
                    <div
                      className="w-full h-14 rounded-lg mb-2 border border-[#CFCDC5] flex items-end justify-end p-1.5"
                      style={{ backgroundColor: c.hex }}
                    >
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 text-white rounded p-0.5">
                        <span className="material-symbols-outlined text-xs">content_copy</span>
                      </span>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-[#171717] leading-tight">{c.label}</div>
                      <div className="font-mono text-[10px] text-[#737373] mt-0.5">{c.hex}</div>
                      <div className="text-[9px] text-[#737373] mt-1 leading-tight">{c.desc}</div>
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
        <h2 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#16845B]" />
          3. Escala Tipográfica (Plus Jakarta Sans &amp; JetBrains Mono)
        </h2>

        <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-6 space-y-4 shadow-xs">
          <div className="space-y-3 divide-y divide-[#CFCDC5]">
            <div className="pt-2">
              <span className="text-[10px] uppercase font-mono text-[#737373]">Display-LG • 32px ExtraBold</span>
              <div className="text-3xl font-extrabold text-[#171717] tracking-tight mt-1">
                Cockpit Operacional MK9
              </div>
            </div>
            <div className="pt-3">
              <span className="text-[10px] uppercase font-mono text-[#737373]">Headline-XL • 24px Bold</span>
              <div className="text-2xl font-bold text-[#171717] tracking-tight mt-1">
                Painel Operacional de Trade Marketing
              </div>
            </div>
            <div className="pt-3">
              <span className="text-[10px] uppercase font-mono text-[#737373]">KPI Metric • 32px Tabular Numerals (JetBrains Mono)</span>
              <div className="text-3xl font-extrabold text-[#171717] font-mono mt-1 flex items-baseline gap-3">
                <span>R$ 238.053,60</span>
                <span className="text-[#16845B] text-sm font-bold">+14 este mês</span>
              </div>
            </div>
            <div className="pt-3">
              <span className="text-[10px] uppercase font-mono text-[#737373]">Body-MD • 13px Regular</span>
              <p className="text-xs sm:text-sm text-[#525252] mt-1 max-w-3xl leading-relaxed font-sans">
                Acompanhamento em tempo real de promotores de campo, cumprimento de rotas, índice de ruptura e conformidade de gôndola em PDVs de redes estratégicas brasileiras.
              </p>
            </div>
            <div className="pt-3">
              <span className="text-[10px] uppercase font-mono text-[#737373]">Label-Mono • 11px JetBrains Mono</span>
              <div className="font-mono text-xs text-[#286FF5] mt-1">
                MAT-84920 • CPF: ***.418.092-** • GEOFENCE 412M OK • STATUS: 200 OK
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Component Library Showcase */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#D98A00]" />
          4. Biblioteca de Componentes ArtCraft / GridCraft
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Botões */}
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-5 space-y-4 shadow-xs">
            <span className="text-xs font-mono font-bold text-[#737373] uppercase">Botões &amp; Ações</span>
            <div className="flex flex-wrap items-center gap-3">
              <button className="px-4 py-2 rounded-lg bg-[#111114] hover:bg-black text-white font-bold text-xs cursor-pointer shadow-xs">
                + Novo cadastro
              </button>
              <button className="px-4 py-2 rounded-lg bg-white hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer">
                Exportar Base
              </button>
              <button className="px-4 py-2 rounded-lg bg-[#286FF5] hover:bg-blue-600 text-white font-bold text-xs cursor-pointer">
                Ação Destacada
              </button>
              <button className="px-4 py-2 rounded-lg bg-[#FDF2F2] hover:bg-rose-100 text-[#D93636] border border-[#F8C8C8] font-bold text-xs cursor-pointer">
                Ação Destrutiva
              </button>
            </div>
          </div>

          {/* Badges de Status */}
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-5 space-y-4 shadow-xs">
            <span className="text-xs font-mono font-bold text-[#737373] uppercase">Badges de Telemetria</span>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E8F5EE] border border-[#B9E5D0] text-[#16845B]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#16845B]" />
                ATIVO / CONFORME
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FFF8E6] border border-[#FCE19B] text-[#D98A00]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D98A00]" />
                A PAGAR / JANELA
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FDF2F2] border border-[#F8C8C8] text-[#D93636]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D93636]" />
                RUPTURA CRÍTICA
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#EBF2FE] border border-[#C3D9FD] text-[#286FF5]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#286FF5]" />
                PONTO EXTRA VALIDADO
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E4E2DB] border border-[#CFCDC5] text-[#737373]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#737373]" />
                INATIVO
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
