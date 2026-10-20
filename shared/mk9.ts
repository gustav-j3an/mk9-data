export type AbsenceStatus = 'Em análise' | 'Processado' | 'Necessita atenção' | 'Cancelado' | 'Em processamento';
export interface Absence {
  protocolo: string;
  matricula: string;
  nome: string;
  projeto: string;
  supervisor: string;
  tipo: 'Falta' | 'Atestado' | 'Ausência';
  inicio: string | null;
  fim: string | null;
  retorno: string | null;
  dias: number | null;
  status: AbsenceStatus;
}
export interface AbsencesResult {
  data: Absence[];
  updatedAt: string;
  activePromoters: number;
  projects: { nome: string; activePromoters: number }[];
}
export function friendlyStatus(status: unknown, processing?: unknown): AbsenceStatus {
  const values = [status, processing].filter((v): v is string => typeof v === 'string').map(v => v.toUpperCase());
  if (values.includes('CANCELADO')) return 'Cancelado';
  if (values.some(v => ['REJEITADO', 'PENDENCIA'].includes(v))) return 'Necessita atenção';
  if (values.some(v => ['PROCESSADO', 'CONCLUIDO', 'APROVADO'].includes(v))) return 'Processado';
  if (values.some(v => ['PENDENTE', 'AGUARDANDO', 'EM_ANALISE'].includes(v))) return 'Em análise';
  return 'Em processamento';
}
