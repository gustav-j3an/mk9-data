import type { ScreenId, UserRole } from './types';

const screens: ScreenId[] = [
  'faltas-atestados', 'rh-matriculas', 'rh-ausencias', 'cockpit', 'painel-operacional',
  'acompanhamento-visitas', 'presenca', 'rotas-fixas', 'industrias', 'lojas',
  'portal-promotor', 'portal-industria', 'gestao-equipes', 'supervisores', 'freelancers',
  'controle-diarias', 'promotores', 'importacao', 'design-system', 'usuarios', 'meu-perfil'
];

export function screenPath(screen: ScreenId): string {
  return `/${screen}`;
}

export function screenFromPath(pathname: string): ScreenId | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return null;
  const candidate = path.slice(1);
  return screens.includes(candidate as ScreenId) ? candidate as ScreenId : null;
}

export function defaultScreenForRole(role: UserRole | string): ScreenId {
  if (role === 'promotor') return 'portal-promotor';
  if (role === 'client_industry') return 'portal-industria';
  return 'cockpit';
}

export function roleCanOpenScreen(screen: ScreenId, role: UserRole | string): boolean {
  if (screen === 'faltas-atestados' || screen === 'rh-ausencias') return true;
  if (screen === 'rh-matriculas') return role === 'admin';
  if (screen === 'meu-perfil') return true;
  if (role === 'promotor') return screen === 'portal-promotor';
  if (role === 'client_industry') return screen === 'portal-industria';
  if (role === 'operador') return screen !== 'importacao' && screen !== 'usuarios';
  if (role === 'gestor') return screen !== 'usuarios';
  return true;
}
