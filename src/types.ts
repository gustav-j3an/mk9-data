export type ScreenId = 
  | 'cockpit'
  | 'painel-operacional'
  | 'presenca'
  | 'gestao-equipes'
  | 'freelancers'
  | 'controle-diarias'
  | 'promotores'
  | 'design-system';

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
