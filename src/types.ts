export type ScreenId = 
  | 'faltas-atestados'
  | 'rh-matriculas'
  | 'rh-ausencias'
  | 'cockpit'
  | 'painel-operacional'
  | 'acompanhamento-visitas'
  | 'presenca'
  | 'rotas-fixas'
  | 'industrias'
  | 'lojas'
  | 'portal-promotor'
  | 'portal-industria'
  | 'gestao-equipes'
  | 'supervisores'
  | 'freelancers'
  | 'controle-diarias'
  | 'promotores'
  | 'importacao'
  | 'design-system'
  | 'usuarios'
  | 'meu-perfil';

export interface IndustryItem {
  id: string;
  codigo: string;
  nome: string;
  cnpj: string | null;
  status: 'ativo' | 'inativo';
  observacao?: string | null;
  data_inicio_operacao?: string | null;
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

export type ContratoFrequencia = 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
export type ContratoStatus = 'ativo' | 'inativo' | 'suspenso' | 'encerrado';
export type CicloQuinzenal = 'PAR_IMPAR' | 'SEMANA_1_3' | 'SEMANA_2_4' | 'QUINZENAL_LIVRE';

export interface ContratoLoja {
  id: string;
  industria_codigo: string;
  loja_codigo: string;
  frequencia: ContratoFrequencia;
  visitas_por_semana?: number | null;
  segunda: boolean;
  terca: boolean;
  quarta: boolean;
  quinta: boolean;
  sexta: boolean;
  sabado: boolean;
  domingo: boolean;
  ciclo_quinzenal?: CicloQuinzenal;
  data_inicio_vigencia: string;
  data_fim_vigencia?: string | null;
  status: ContratoStatus;
  valor_por_visita?: number | null;
  origem?: 'manual' | 'migracao_rotas' | 'importacao_planilha' | 'sistema';
  observacao?: string | null;
  created_at?: string;
  updated_at?: string;

  // Relacionamentos carregados via Join
  industria?: { codigo: string; nome: string; cnpj?: string | null } | null;
  loja?: { codigo: string; nome: string; cidade?: string; uf?: string; rede?: string | null } | null;
}

export interface CreateContratoLojaDTO {
  industria_codigo: string;
  loja_codigo: string;
  frequencia: ContratoFrequencia;
  visitas_por_semana?: number;
  segunda?: boolean;
  terca?: boolean;
  quarta?: boolean;
  quinta?: boolean;
  sexta?: boolean;
  sabado?: boolean;
  domingo?: boolean;
  ciclo_quinzenal?: CicloQuinzenal;
  data_inicio_vigencia?: string;
  data_fim_vigencia?: string | null;
  status?: ContratoStatus;
  valor_por_visita?: number | null;
  observacao?: string | null;

  // Parâmetros opcionais para solicitar expressamente o cálculo do período contratual:
  // Se calcular_periodo = true, o serviço usa calcularPeriodoContratual()
  calcular_periodo?: boolean;
  data_referencia?: string;
  data_cadastro?: string | null;
}

export interface UpdateContratoLojaDTO {
  frequencia?: ContratoFrequencia;
  visitas_por_semana?: number;
  segunda?: boolean;
  terca?: boolean;
  quarta?: boolean;
  quinta?: boolean;
  sexta?: boolean;
  sabado?: boolean;
  domingo?: boolean;
  ciclo_quinzenal?: CicloQuinzenal;
  data_inicio_vigencia?: string;
  data_fim_vigencia?: string | null;
  status?: ContratoStatus;
  valor_por_visita?: number | null;
  observacao?: string | null;
}

export interface PeriodoContratual {
  data_inicio: string; // YYYY-MM-DD
  data_fim: string;    // YYYY-MM-DD
  competencia: string; // Identificador da competência YYYY-MM
  industria_codigo: string;
  tipo_ciclo: 'ESPECIAL_KING_23_22' | 'MENSAL_PADRAO' | 'PRIMEIRA_VIGENCIA_PRO_RATA';
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

export type OperationMode = 'IMPLANTACAO' | 'OPERACAO_OFICIAL';

export interface SystemSettingsState {
  mode: OperationMode | 'DESCONHECIDO';
  officialStartDate: string | null;
  status: 'loading' | 'loaded' | 'error';
  error: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface SystemSettingsAuditRecord {
  id: string;
  changed_at: string;
  changed_by?: string | null;
  changed_by_name?: string | null;
  changed_by_email?: string | null;
  previous_mode: string;
  new_mode: string;
  previous_start_date?: string | null;
  new_start_date?: string | null;
  justification: string;
}

export type UserRole = 'admin' | 'gestor' | 'operador' | 'promotor' | 'client_industry';

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
  industria_codigo?: string | null;
  industria_nome?: string | null;
  avatar_url?: string;
  phone?: string | null;
  department?: string;
  status?: 'ativo' | 'inativo';
  created_at?: string;
  updated_at?: string;
}

export type PromoterAuthorizationStatus = 'liberado' | 'bloqueado';

export interface PromoterOperationAuthorization {
  id: string;
  promotor_matricula: string;
  status: PromoterAuthorizationStatus;
  authorized_at: string;
  authorized_by?: string | null;
  authorized_by_name?: string | null;
  authorized_by_email?: string | null;
  justification: string;
  revoked_at?: string | null;
  revoked_by?: string | null;
  revoked_by_name?: string | null;
  revoked_by_email?: string | null;
  revocation_reason?: string | null;
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
  gps_accuracy_meters?: number | null;
  checkout_latitude?: number | null;
  checkout_longitude?: number | null;
  checkout_accuracy_meters?: number | null;
  work_schedule_id?: string | null;
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
  validity_items?: VisitProductValidity[];
}

export type AlertPriority = 'critico' | 'atencao' | 'pendente' | 'resolvido';
export type AlertType = 'ruptura' | 'validade' | 'visita' | 'aderencia';

export type NotificationType =
  | 'ruptura'
  | 'produto_vencido'
  | 'produto_3_dias'
  | 'produto_4_7_dias'
  | 'produto_8_30_dias'
  | 'visita_2h'
  | 'visita_nao_realizada'
  | 'rota_sem_atendimento'
  | 'baixa_aderencia'
  | 'aderencia_media';

export interface AppNotification {
  id: string;
  user_id: string;
  promotor_matricula?: string | null;
  titulo: string;
  mensagem: string;
  tipo: NotificationType;
  prioridade: AlertPriority;
  alert_fingerprint: string;
  link_action?: string | null;
  read: boolean;
  created_at: string;
  read_at?: string | null;
}

export interface AlertItem {
  id: string;
  prioridade: AlertPriority;
  tipo: AlertType;
  data: string;
  loja: string;
  lojaCodigo?: string;
  industria: string;
  industriaCodigo?: string;
  promotor: string;
  promotorMatricula?: string;
  titulo: string;
  descricao: string;
  origem: string;
  statusVisual: string;
  visitObj?: Visit | null;
  occurrenceId?: string;
  createdAtTimestamp?: number;
}

export interface VisitProductValidity {
  id?: string;
  visit_id?: string;
  produto_nome: string;
  quantidade: number;
  data_vencimento: string;
  lote?: string | null;
  observacao?: string | null;
  created_at?: string;
}

export interface VisitChecklistItem {
  id?: string;
  visit_id?: string;
  item_key: string;
  item_label: string;
  checked: boolean | null;
  valor_texto?: string | null;
  observacao?: string | null;
}

export interface VisitPhoto {
  id?: string;
  visit_id?: string;
  tipo_foto: 'fachada' | 'gondola' | 'preco' | 'ponto_extra' | 'ruptura' | 'outros';
  storage_path: string;
  file_url: string;
  signed_url?: string;
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

export type EquipeStatus = 'ativa' | 'reestruturacao' | 'arquivada';

export interface Equipe {
  id: string;
  codigo: string;
  nome: string;
  regional: string | null;
  supervisor_id?: string | null;
  supervisor_nome: string | null;
  status: EquipeStatus;
  created_at?: string;
  updated_at?: string;
}

export interface EquipeWithMetrics extends Equipe {
  promotoresCount: number;
  pdvsCount: number;
}

export interface CreateEquipeDTO {
  codigo?: string | null;
  nome: string;
  regional?: string | null;
  supervisor_id?: string | null;
  supervisor_nome?: string | null;
  status?: EquipeStatus;
}

export interface UpdateEquipeDTO {
  codigo?: string;
  nome?: string;
  regional?: string | null;
  supervisor_id?: string | null;
  supervisor_nome?: string | null;
  status?: EquipeStatus;
}

export type SupervisorStatus = 'ativo' | 'inativo' | 'ferias' | 'afastado';

export interface Supervisor {
  id: string;
  codigo: string;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  regional?: string | null;
  status: SupervisorStatus;
  user_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateSupervisorDTO {
  codigo?: string | null;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  regional?: string | null;
  status?: SupervisorStatus;
  user_id?: string | null;
}

export interface UpdateSupervisorDTO {
  codigo?: string;
  nome?: string;
  email?: string | null;
  telefone?: string | null;
  regional?: string | null;
  status?: SupervisorStatus;
  user_id?: string | null;
}

export interface ListSupervisoresFilters {
  status?: SupervisorStatus | 'all';
  search?: string;
  regional?: string;
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
