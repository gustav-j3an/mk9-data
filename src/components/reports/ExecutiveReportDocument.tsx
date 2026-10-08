import React from 'react';

export interface ExecutiveReportDocumentProps {
  indName?: string;
  activeIndName?: string;
  indCode?: string | null;
  activeIndCode?: string | null;
  periodLabel?: string;
  periodFilter?: 'today' | 'week' | 'month';
  lastUpdate?: string;
  kpis: {
    lojas: number;
    lojasComVisita: number;
    planejadas: number;
    concluidas: number;
    emAndamento?: number;
    pendentes: number;
    pendentesHoje?: number;
    atrasadas: number;
    naoRealizadas: number;
    aderencia: number;
  };
  temporalEvolution: Array<{
    dateStr: string;
    dayShort: string;
    planejadas: number;
    realizadas: number;
    pendentes: number;
  }>;
  occurrencesSummary: {
    rupturas: number;
    preco: number;
    espaco: number;
    outros: number;
    total: number;
  };
  validitySummary: {
    vencidos: number;
    vencendo3d: number;
    vencendo7d: number;
    vencendo30d: number;
    totalAuditados: number;
  };
  photosSummary: {
    fachada: number;
    gondola: number;
    preco: number;
    ponto_extra: number;
    ruptura: number;
    outros: number;
    total: number;
  };
  promotoresPerformance: Array<{
    matricula: string;
    nome: string;
    planejadas: number;
    concluidas: number;
    pendentes: number;
    atrasadas: number;
    aderencia: number;
  }>;
  topProblematicLojas: Array<{
    codigo: string;
    nome: string;
    cidade: string;
    uf: string;
    planejadas: number;
    concluidas: number;
    atrasadas: number;
    aderencia: number;
  }>;
}

export const ExecutiveReportDocument: React.FC<ExecutiveReportDocumentProps> = ({
  indName,
  activeIndName,
  indCode,
  activeIndCode,
  periodLabel,
  periodFilter,
  lastUpdate,
  kpis,
  temporalEvolution,
  occurrencesSummary,
  validitySummary,
  photosSummary,
  promotoresPerformance,
  topProblematicLojas
}) => {
  const finalIndName = activeIndName || indName || 'Indústria';
  const finalIndCode = activeIndCode !== undefined ? activeIndCode : (indCode || '');
  const finalPeriodLabel = periodLabel || (periodFilter === 'week' ? 'Últimos 7 dias' : periodFilter === 'month' ? 'Últimos 30 dias' : 'Hoje');
  const finalLastUpdate = lastUpdate || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const isLargeTeam = promotoresPerformance.length > 10;
  const isMultiPageReport = isLargeTeam || topProblematicLojas.length > 8;
  const totalPages = isMultiPageReport ? 3 : 2;
  const emissaoDate = new Date().toLocaleDateString('pt-BR');

  return (
    <div className="hidden print:block font-sans text-slate-900 bg-white p-0 m-0 w-full">
      {/* ================= PÁGINA 1 — RESUMO EXECUTIVO ================= */}
      <section className="print-page flex flex-col justify-between p-8 min-h-[290mm] border-b border-slate-200">
        <div className="space-y-6">
          {/* Cabeçalho Institucional MK9 */}
          <div className="border-b-2 border-slate-900 pb-4 flex justify-between items-end">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-slate-900 text-white font-extrabold flex items-center justify-center text-xs font-mono">
                  MK
                </div>
                <h1 className="text-xl font-extrabold tracking-wider text-slate-900 font-mono">
                  MK9 TRADE MARKETING
                </h1>
              </div>
              <p className="text-[11px] text-slate-500 font-mono mt-1 font-semibold uppercase">
                RELATÓRIO EXECUTIVO DE OPERAÇÃO & ADERÊNCIA DE CAMPO
              </p>
            </div>
            <div className="text-right font-mono text-[10px] text-slate-600">
              <div>Parceiro: <strong className="text-slate-900 font-bold">{finalIndName} ({finalIndCode || 'GLOBAL'})</strong></div>
              <div>Período: <strong className="text-slate-900 font-bold">{finalPeriodLabel}</strong></div>
              <div>Emissão: {emissaoDate} às {finalLastUpdate}</div>
            </div>
          </div>

          {/* Contexto Executivo */}
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-none text-xs space-y-1">
            <div className="font-bold font-mono uppercase text-slate-800 tracking-wide">Síntese da Operação</div>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              Documento oficial consolidado de telemetria operacional. Apresenta o nível de execução, cobertura de PDVs e ocorrências identificadas na operação no período analisado.
            </p>
          </div>

          {/* Grid de 6 KPIs Editoriais Limpos */}
          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 border-b border-slate-200 pb-1">
              1. Indicadores Chave de Desempenho (KPIs)
            </h2>
            <div className="grid grid-cols-3 gap-3 font-mono">
              <div className="border border-slate-300 p-3 bg-white">
                <span className="text-[9px] font-bold text-slate-500 uppercase block">PDVs Contratados</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{kpis.lojas}</span>
                <span className="text-[9px] text-slate-500 block mt-0.5">{kpis.lojasComVisita} com atendimento concluído</span>
              </div>

              <div className="border border-slate-300 p-3 bg-white">
                <span className="text-[9px] font-bold text-slate-500 uppercase block">Visitas Planejadas</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{kpis.planejadas}</span>
                <span className="text-[9px] text-slate-500 block mt-0.5">Atendimentos previstos</span>
              </div>

              <div className="border border-slate-300 p-3 bg-white">
                <span className="text-[9px] font-bold text-emerald-700 uppercase block">Visitas Concluídas</span>
                <span className="text-2xl font-black text-emerald-700 mt-1 block">{kpis.concluidas}</span>
                <span className="text-[9px] text-emerald-600 block mt-0.5">Check-outs validados</span>
              </div>

              <div className="border border-slate-300 p-3 bg-white">
                <span className="text-[9px] font-bold text-amber-700 uppercase block">Visitas Pendentes</span>
                <span className="text-2xl font-black text-amber-700 mt-1 block">{kpis.pendentes}</span>
                <span className="text-[9px] text-amber-600 block mt-0.5 truncate">{kpis.atrasadas} atrasadas • {kpis.pendentesHoje ?? 0} hoje</span>
              </div>

              <div className="border border-slate-300 p-3 bg-white">
                <span className="text-[9px] font-bold text-slate-600 uppercase block">Não Realizadas</span>
                <span className="text-2xl font-black text-slate-800 mt-1 block">{kpis.naoRealizadas}</span>
                <span className="text-[9px] text-slate-500 block mt-0.5">Visitas justificadas</span>
              </div>

              <div className="border border-slate-300 p-3 bg-slate-900 text-white">
                <span className="text-[9px] font-bold text-slate-300 uppercase block">Aderência Operacional</span>
                <span className="text-2xl font-black text-white mt-1 block">{kpis.aderencia}%</span>
                <span className="text-[9px] text-slate-400 block mt-0.5">Taxa de Execução</span>
              </div>
            </div>
          </div>

          {/* Evolução Temporal & Atenção na Operação */}
          <div className="space-y-4 pt-2">
            <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 border-b border-slate-200 pb-1">
              2. Ritmo de Execução & Pontos de Atenção
            </h2>

            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
              {/* Evolução Temporal Resumida */}
              <div className="border border-slate-200 p-3 space-y-2">
                <div className="font-bold text-slate-800 text-[11px]">Evolução do Período ({periodLabel})</div>
                <div className="space-y-1.5 max-h-48 overflow-hidden">
                  {temporalEvolution.slice(0, 6).map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-600">{item.dateStr} ({item.dayShort})</span>
                      <div className="flex gap-2">
                        <span className="text-emerald-700 font-bold">Conf: {item.realizadas}</span>
                        <span className="text-amber-700 font-bold">Pend: {item.pendentes}</span>
                        <span className="text-slate-500 font-bold">Tot: {item.planejadas}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Destaques da Operação */}
              <div className="border border-slate-200 p-3 space-y-2 text-[11px]">
                <div className="font-bold text-slate-800">Alertas da Operação</div>
                <div className="space-y-2 text-slate-700">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                    <span>Atrasos Críticos:</span>
                    <strong className={kpis.atrasadas > 0 ? 'text-rose-700 font-bold' : 'text-emerald-700'}>
                      {kpis.atrasadas} atendimento(s)
                    </strong>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                    <span>Cobertura de Lojas:</span>
                    <strong className="text-slate-900 font-bold">
                      {kpis.lojas > 0 ? Math.round((kpis.lojasComVisita / kpis.lojas) * 100) : 0}% dos PDVs
                    </strong>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                    <span>Ruptura Identificada:</span>
                    <strong className="text-rose-700 font-bold">{occurrencesSummary.rupturas} ocorrência(s)</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Produtos Vencidos:</span>
                    <strong className={validitySummary.vencidos > 0 ? 'text-rose-700 font-bold' : 'text-emerald-700'}>
                      {validitySummary.vencidos} produto(s)
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé da Página 1 */}
        <div className="border-t border-slate-300 pt-3 flex justify-between items-center text-[10px] text-slate-500 font-mono">
          <span>MK9 Trade Marketing • Relatório Executivo Corporativo</span>
          <span>Página 1 de {totalPages}</span>
        </div>
      </section>

      {/* ================= PÁGINA 2 — DESEMPENHO & AUDITORIA DE CAMPO ================= */}
      <section className="print-page flex flex-col justify-between p-8 min-h-[290mm] border-b border-slate-200">
        <div className="space-y-6">
          {/* Cabeçalho Secundário */}
          <div className="border-b border-slate-300 pb-2 flex justify-between items-center font-mono text-[10px] text-slate-500">
            <span className="font-bold text-slate-900">MK9 TRADE MARKETING — RELATÓRIO EXECUTIVO</span>
            <span>Parceiro: {indName} • Período: {periodLabel}</span>
          </div>

          {/* Desempenho da Equipe de Promotores */}
          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 border-b border-slate-200 pb-1">
              3. Desempenho por Promotor de Campo ({promotoresPerformance.length})
            </h2>
            <div className="border border-slate-300 overflow-hidden font-mono text-[10px]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 border-b border-slate-300 uppercase">
                    <th className="py-1.5 px-3">Promotor</th>
                    <th className="py-1.5 px-2 text-center">Matrícula</th>
                    <th className="py-1.5 px-2 text-center">Planejadas</th>
                    <th className="py-1.5 px-2 text-center">Concluídas</th>
                    <th className="py-1.5 px-2 text-center">Pendentes</th>
                    <th className="py-1.5 px-2 text-center">Atrasadas</th>
                    <th className="py-1.5 px-2 text-center">Aderência</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {promotoresPerformance.slice(0, isLargeTeam ? 8 : 12).map((p) => (
                    <tr key={p.matricula}>
                      <td className="py-1.5 px-3 font-bold">{p.nome}</td>
                      <td className="py-1.5 px-2 text-center font-mono text-slate-500">{p.matricula}</td>
                      <td className="py-1.5 px-2 text-center font-bold">{p.planejadas}</td>
                      <td className="py-1.5 px-2 text-center text-emerald-700 font-bold">{p.concluidas}</td>
                      <td className="py-1.5 px-2 text-center text-amber-700 font-bold">{p.pendentes}</td>
                      <td className="py-1.5 px-2 text-center text-rose-700 font-bold">{p.atrasadas}</td>
                      <td className="py-1.5 px-2 text-center font-bold">{p.aderencia}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Resumo de Ocorrências, Validade e Evidências */}
          <div className="space-y-2 pt-2">
            <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 border-b border-slate-200 pb-1">
              4. Auditoria de Ocorrências & Validade de Produtos
            </h2>

            <div className="grid grid-cols-3 gap-3 font-mono text-[10px]">
              <div className="border border-slate-300 p-3 space-y-1.5">
                <div className="font-bold text-slate-900 border-b border-slate-200 pb-1 uppercase">Ocorrências de Campo</div>
                <div className="flex justify-between"><span>Rupturas:</span><strong className="text-rose-700">{occurrencesSummary.rupturas}</strong></div>
                <div className="flex justify-between"><span>Divergência Preço:</span><strong>{occurrencesSummary.preco}</strong></div>
                <div className="flex justify-between"><span>Falta de Espaço:</span><strong>{occurrencesSummary.espaco}</strong></div>
                <div className="flex justify-between"><span>Outros:</span><span>{occurrencesSummary.outros}</span></div>
              </div>

              <div className="border border-slate-300 p-3 space-y-1.5">
                <div className="font-bold text-slate-900 border-b border-slate-200 pb-1 uppercase">Auditoria de Validade</div>
                <div className="flex justify-between"><span>Produtos Vencidos:</span><strong className={validitySummary.vencidos > 0 ? 'text-rose-700' : ''}>{validitySummary.vencidos}</strong></div>
                <div className="flex justify-between"><span>Vencendo ≤ 3 dias:</span><strong className="text-amber-700">{validitySummary.vencendo3d}</strong></div>
                <div className="flex justify-between"><span>Vencendo 4–7 dias:</span><span>{validitySummary.vencendo7d}</span></div>
                <div className="flex justify-between"><span>Vencendo 8–30 dias:</span><span>{validitySummary.vencendo30d}</span></div>
              </div>

              <div className="border border-slate-300 p-3 space-y-1.5">
                <div className="font-bold text-slate-900 border-b border-slate-200 pb-1 uppercase">Evidências Registradas</div>
                <div className="flex justify-between"><span>Exposição / Gôndola:</span><strong>{photosSummary.gondola}</strong></div>
                <div className="flex justify-between"><span>Fachada / Entrada:</span><strong>{photosSummary.fachada}</strong></div>
                <div className="flex justify-between"><span>Etiquetas de Preço:</span><strong>{photosSummary.preco}</strong></div>
                <div className="flex justify-between"><span>Pontos Extras:</span><strong>{photosSummary.ponto_extra}</strong></div>
              </div>
            </div>
          </div>

          {/* Top Exceções Operacionais (PDVs com Maior Necessidade de Ajuste) */}
          {topProblematicLojas.length > 0 && (
            <div className="space-y-2 pt-2">
              <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 border-b border-slate-200 pb-1">
                5. Exceções Operacionais — PDVs com Baixa Aderência ou Atrasos
              </h2>
              <div className="border border-slate-300 overflow-hidden font-mono text-[10px]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b border-slate-300 uppercase">
                      <th className="py-1.5 px-3">Código / Loja</th>
                      <th className="py-1.5 px-2">Cidade/UF</th>
                      <th className="py-1.5 px-2 text-center">Planejadas</th>
                      <th className="py-1.5 px-2 text-center">Realizadas</th>
                      <th className="py-1.5 px-2 text-center">Atrasadas</th>
                      <th className="py-1.5 px-2 text-center">Aderência</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {topProblematicLojas.slice(0, 6).map((l) => (
                      <tr key={l.codigo}>
                        <td className="py-1.5 px-3 font-bold">{l.nome} ({l.codigo})</td>
                        <td className="py-1.5 px-2 text-slate-600">{l.cidade} - {l.uf}</td>
                        <td className="py-1.5 px-2 text-center">{l.planejadas}</td>
                        <td className="py-1.5 px-2 text-center text-emerald-700 font-bold">{l.concluidas}</td>
                        <td className="py-1.5 px-2 text-center text-rose-700 font-bold">{l.atrasadas}</td>
                        <td className="py-1.5 px-2 text-center font-bold">{l.aderencia}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé da Página 2 */}
        <div className="border-t border-slate-300 pt-3 flex justify-between items-center text-[10px] text-slate-500 font-mono">
          <span>MK9 Trade Marketing • Relatório Executivo Corporativo</span>
          <span>Página 2 de {totalPages}</span>
        </div>
      </section>

      {/* ================= PÁGINA 3 — APENAS SE HOUVER MUITOS PROMOTORES (> 10) ================= */}
      {isMultiPageReport && (
        <section className="print-page flex flex-col justify-between p-8 min-h-[290mm]">
          <div className="space-y-6">
            {/* Cabeçalho Secundário */}
            <div className="border-b border-slate-300 pb-2 flex justify-between items-center font-mono text-[10px] text-slate-500">
              <span className="font-bold text-slate-900">MK9 TRADE MARKETING — RELATÓRIO EXECUTIVO (CONTINUAÇÃO)</span>
              <span>Parceiro: {indName} • Período: {periodLabel}</span>
            </div>

            {/* Continuação da Equipe de Promotores */}
            <div className="space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 border-b border-slate-200 pb-1">
                6. Continuação — Desempenho por Promotor de Campo
              </h2>
              <div className="border border-slate-300 overflow-hidden font-mono text-[10px]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b border-slate-300 uppercase">
                      <th className="py-1.5 px-3">Promotor</th>
                      <th className="py-1.5 px-2 text-center">Matrícula</th>
                      <th className="py-1.5 px-2 text-center">Planejadas</th>
                      <th className="py-1.5 px-2 text-center">Concluídas</th>
                      <th className="py-1.5 px-2 text-center">Pendentes</th>
                      <th className="py-1.5 px-2 text-center">Atrasadas</th>
                      <th className="py-1.5 px-2 text-center">Aderência</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {promotoresPerformance.slice(8).map((p) => (
                      <tr key={p.matricula}>
                        <td className="py-1.5 px-3 font-bold">{p.nome}</td>
                        <td className="py-1.5 px-2 text-center font-mono text-slate-500">{p.matricula}</td>
                        <td className="py-1.5 px-2 text-center font-bold">{p.planejadas}</td>
                        <td className="py-1.5 px-2 text-center text-emerald-700 font-bold">{p.concluidas}</td>
                        <td className="py-1.5 px-2 text-center text-amber-700 font-bold">{p.pendentes}</td>
                        <td className="py-1.5 px-2 text-center text-rose-700 font-bold">{p.atrasadas}</td>
                        <td className="py-1.5 px-2 text-center font-bold">{p.aderencia}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Rodapé da Página 3 */}
          <div className="border-t border-slate-300 pt-3 flex justify-between items-center text-[10px] text-slate-500 font-mono">
            <span>MK9 Trade Marketing • Relatório Executivo Corporativo</span>
            <span>Página 3 de 3</span>
          </div>
        </section>
      )}
    </div>
  );
};
