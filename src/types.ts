export type ScreenId = 
  | 'cockpit'
  | 'painel-operacional'
  | 'presenca'
  | 'rotas-fixas'
  | 'industrias'
  | 'lojas'
  | 'portal-promotor'
  | 'gestao-equipes'
  | 'freelancers'
  | 'controle-diarias'
  | 'promotores'
  | 'importacao'
  | 'design-system'
  | 'usuarios';

export interface IndustryItem {
  id: string;
  codigo: string;
  nome: string;
  cnpj: string | null;
  status: 'ativo' | 'inativo';
  observacao?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StoreItem {
  id: string;
  codigo: string;
  nome: string;
  cnpj: string | null;
  cidade: string;
  uf: string;
  endereco?: string | null;
  rede?: string | null;
  status: 'ativo' | 'inativo';
  created_at?: string;
  updated_at?: string;
}

export interface RouteItem {
  id: string;
  codigo_rota: string;
  industria_codigo: string;
  loja_codigo: string;
  promotor_matricula: string;
  uf: string | null;
  frequencia: 'SEMANAL' | 'QUINZENAL';
  segunda: boolean;
  terca: boolean;
  quarta: boolean;
  quinta: boolean;
  sexta: boolean;
  sabado: boolean;
  domingo: boolean;
  observacao?: string | null;
  created_at?: string;
  updated_at?: string;
  // Relacionamentos com joins
  industria?: { codigo: string; nome: string } | null;
  loja?: { codigo: string; nome: string; cidade?: string; uf?: string } | null;
  promotor?: { matricula: string; nome: string; supervisor?: string; equipe?: string } | null;
}

export type ImportType = 'industrias' | 'lojas' | 'promotores' | 'rotas';

export interface ImportRowError {
  rowNumber: number;
  column: string;
  value: string;
  message: string;
}

export interface ImportHistoryRecord {
  id: string;
  tipo: ImportType;
  filename: string;
  imported_by_id?: string;
  imported_by_email: string;
  imported_by_name?: string;
  rows_total: number;
  rows_accepted: number;
  rows_rejected: number;
  is_upsert: boolean;
  errors_summary: ImportRowError[];
  created_at: string;
}

export type UserRole = 'admin' | 'gestor' | 'operador' | 'promotor';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  promotor_matricula?: string | null;
  promotor_nome?: string | null;
  promotor_cidade?: string | null;
  promotor_uf?: string | null;
  promotor_supervisor?: string | null;
  promotor_equipe?: string | null;
  avatar_url?: string;
  department?: string;
  status?: 'ativo' | 'inativo';
  created_at?: string;
  updated_at?: string;
}

export type VisitStatus = 'pendente' | 'em_andamento' | 'concluida' | 'nao_realizada';

export interface Visit {
  id: string;
  rota_id?: string | null;
  promotor_matricula: string;
  loja_codigo: string;
  industria_codigo: string;
  data_visita: string;
  started_at?: string | null;
  completed_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: VisitStatus;
  motivo_nao_realizada?: string | null;
  observacao_geral?: string | null;
  created_at?: string;
  updated_at?: string;

  // Relacionamentos com Joins
  promotor?: { matricula: string; nome: string } | null;
  loja?: { codigo: string; nome: string; cidade?: string; uf?: string; endereco?: string } | null;
  industria?: { codigo: string; nome: string } | null;
  rota?: RouteItem | null;
  checklist_items?: VisitChecklistItem[];
  photos?: VisitPhoto[];
  occurrences?: VisitOccurrence[];
}

export interface VisitChecklistItem {
  id?: string;
  visit_id?: string;
  item_key: string;
  item_label: string;
  checked: boolean;
  valor_texto?: string | null;
  observacao?: string | null;
}

export interface VisitPhoto {
  id?: string;
  visit_id?: string;
  tipo_foto: 'fachada' | 'gondola' | 'preco' | 'ponto_extra' | 'ruptura' | 'outros';
  storage_path: string;
  file_url: string;
  legenda?: string | null;
  created_at?: string;
}

export interface VisitOccurrence {
  id?: string;
  visit_id?: string;
  tipo: 'ruptura' | 'preco_divergente' | 'falta_espaco' | 'outro';
  descricao: string;
  resolvido?: boolean;
  created_at?: string;
}

export interface Freelancer {
  id: string;
  name: string;
  initials: string;
  cpf: string;
  phone: string;
  city: string;
  state: string;
  defaultFee: number;
  pixKey: string;
  pixType: 'cpf' | 'celular' | 'email' | 'aleatoria';
  status: 'ativo' | 'inativo';
  lastActivity: string;
  lastStore: string;
  notes?: string;
  activeToday?: boolean;
}

export interface Promoter {
  id: string;
  matricula: string;
  name: string;
  initials: string;
  contractType: 'CLT' | 'Freelancer';
  cpf: string;
  phone: string;
  email?: string;
  birthDate?: string;
  admissionDate?: string;
  role?: string;
  city: string;
  state: string;
  supervisor: string;
  squad: string;
  status: 'ativo' | 'ferias' | 'afastado' | 'arquivado';
  operationalTodayStatus: 'campo' | 'folga' | 'falta' | 'atestado' | 'sem_registro';
}

export interface DailyRecord {
  id: string;
  date: string;
  dayOfWeek: string;
  freelancerId: string;
  freelancerName: string;
  freelancerInitials: string;
  freelancerCpf: string;
  storeName: string;
  storeCity: string;
  industry: string;
  industryColor: string;
  amount: number;
  quinzena: string;
  status: 'a_pagar' | 'pago';
  geofenceValidated: boolean;
  notes?: string;
}

export interface SquadTeam {
  id: string;
  code: string;
  name: string;
  region: string;
  supervisorName: string;
  supervisorTitle: string;
  supervisorInitials: string;
  promotersClt: number;
  promotersFree: number;
  coveragePercent: number;
  coverageTrend: string;
  storesCount: number;
  status: 'ativa' | 'reestruturacao' | 'arquivada';
  openPositions?: number;
  description?: string;
}

export interface AttendanceItem {
  id: string;
  promoterId: string;
  name: string;
  initials: string;
  matricula: string;
  type: 'CLT' | 'Freelancer';
  squad: string;
  supervisor: string;
  city: string;
  state: string;
  phone?: string;
  status: 'presente' | 'falta' | 'atestado' | 'sem_registro';
  telemetryTime: string;
  telemetryDetail: string;
  isJustified?: boolean;
  medicalNoteAttached?: boolean;
  medicalDays?: number;
}

export interface OperationalAlert {
  id: string;
  type: 'ruptura' | 'geofence' | 'ia_foto' | 'diaria' | 'ponto_extra' | 'desvio';
  title: string;
  store: string;
  details: string;
  timestamp: string;
  priority: 'alta' | 'media' | 'baixa';
  promoterName?: string;
  resolved?: boolean;
}

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type?: 'success' | 'info' | 'warning' | 'error';
}
