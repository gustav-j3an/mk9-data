import type { RouteItem } from '../types';

const countActiveDays = (route: RouteItem): number =>
  Number(route.segunda) +
  Number(route.terca) +
  Number(route.quarta) +
  Number(route.quinta) +
  Number(route.sexta) +
  Number(route.sabado) +
  Number(route.domingo);

export const calculateRouteIndicators = (routes: RouteItem[]) => {
  const activeRoutes = routes.filter((route) => !route.encerrada_em);

  return {
    totalRotas: activeRoutes.length,
    semanais: activeRoutes.filter((route) => route.frequencia === 'SEMANAL').length,
    quinzenais: activeRoutes.filter((route) => route.frequencia === 'QUINZENAL').length,
    promotoresUnicos: new Set(activeRoutes.map((route) => route.promotor_matricula)).size,
    lojasUnicas: new Set(activeRoutes.map((route) => route.loja_codigo)).size,
    visitasSemanais: activeRoutes
      .filter((route) => route.frequencia === 'SEMANAL')
      .reduce((total, route) => total + countActiveDays(route), 0),
    visitasQuinzenais: activeRoutes
      .filter((route) => route.frequencia === 'QUINZENAL')
      .reduce((total, route) => total + countActiveDays(route), 0)
  };
};
