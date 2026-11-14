import React, { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ScreenId, ToastMessage } from './types';
import { AppShell } from './components/AppShell';
import { RhAbsencesView } from './views/RhAbsencesView';
import { RhAccessProvider, useRhAccess } from './lib/rhAccess';
import { FaltasAtestadosAccessProvider, useFaltasAtestadosAccess } from './lib/faltasAtestadosAccess';
import { RhMatriculasAccessProvider, useRhMatriculasAccess } from './lib/rhMatriculasAccess';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { defaultScreenForRole, roleCanOpenScreen, screenFromPath, screenPath } from './navigation';

const AttendanceControlView = lazy(() => import('./views/AttendanceControlView').then(({ AttendanceControlView }) => ({ default: AttendanceControlView })));
const ImportView = lazy(() => import('./views/ImportView').then(({ ImportView }) => ({ default: ImportView })));
const IndustryPortalView = lazy(() => import('./views/IndustryPortalView').then(({ IndustryPortalView }) => ({ default: IndustryPortalView })));
const VisitsTrackingView = lazy(() => import('./views/VisitsTrackingView').then(({ VisitsTrackingView }) => ({ default: VisitsTrackingView })));
const TeamsManagementView = lazy(() => import('./views/TeamsManagementView').then(({ TeamsManagementView }) => ({ default: TeamsManagementView })));
const SupervisorsManagementView = lazy(() => import('./views/SupervisorsManagementView').then(({ SupervisorsManagementView }) => ({ default: SupervisorsManagementView })));
const FreelancersView = lazy(() => import('./views/FreelancersView').then(({ FreelancersView }) => ({ default: FreelancersView })));
const DailiesControlView = lazy(() => import('./views/DailiesControlView').then(({ DailiesControlView }) => ({ default: DailiesControlView })));
const PromotersView = lazy(() => import('./views/PromotersView').then(({ PromotersView }) => ({ default: PromotersView })));
const DesignSystemView = lazy(() => import('./views/DesignSystemView').then(({ DesignSystemView }) => ({ default: DesignSystemView })));
const UsersPermissionsView = lazy(() => import('./views/UsersPermissionsView').then(({ UsersPermissionsView }) => ({ default: UsersPermissionsView })));
const RoutesView = lazy(() => import('./views/RoutesView').then(({ RoutesView }) => ({ default: RoutesView })));
const IndustriesView = lazy(() => import('./views/IndustriesView').then(({ IndustriesView }) => ({ default: IndustriesView })));
const StoresView = lazy(() => import('./views/StoresView').then(({ StoresView }) => ({ default: StoresView })));
const PromoterPortalView = lazy(() => import('./views/PromoterPortalView').then(({ PromoterPortalView }) => ({ default: PromoterPortalView })));
const ProfileView = lazy(() => import('./views/ProfileView').then(({ ProfileView }) => ({ default: ProfileView })));
const FaltasAtestadosModule = lazy(() => import('./views/FaltasAtestadosModule').then(({ FaltasAtestadosModule }) => ({ default: FaltasAtestadosModule })));
const RhMatriculasReconciliationView = lazy(() => import('./views/RhMatriculasReconciliationView').then(({ RhMatriculasReconciliationView }) => ({ default: RhMatriculasReconciliationView })));
const CockpitView = lazy(() => import('./views/CockpitView').then(({ CockpitView }) => ({ default: CockpitView })));
const OperationalDashboardView = lazy(() => import('./views/OperationalDashboardView').then(({ OperationalDashboardView }) => ({ default: OperationalDashboardView })));

function isScreenAllowedForRole(screen: ScreenId, role: string, rhAllowed = false, faltasAtestadosAllowed = false, rhMatriculasAllowed = false): boolean {
  if (screen === 'faltas-atestados') return faltasAtestadosAllowed;
  if (screen === 'rh-matriculas') return role === 'admin' && rhMatriculasAllowed;
  if (screen === 'rh-ausencias') return rhAllowed;
  return roleCanOpenScreen(screen, role);
}

function Dashboard() {
  const { role } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const rh = useRhAccess();
  const faltasAtestados = useFaltasAtestadosAccess();
  const rhMatriculas = useRhMatriculasAccess();
  const rhAllowed = rh.mine || rh.team || rh.management;
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const requestedScreen = screenFromPath(location.pathname);
  const homeScreen = defaultScreenForRole(role);
  const currentScreen = requestedScreen || homeScreen;
  const accessCheckPending = currentScreen === 'rh-ausencias' && rh.loading
    || currentScreen === 'faltas-atestados' && faltasAtestados.loading
    || currentScreen === 'rh-matriculas' && rhMatriculas.loading;

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);

    setTimeout(() => {
      dismissToast(id);
    }, 4500);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('header input') as HTMLInputElement | null;
        if (searchInput) {
          searchInput.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNavigate = (screen: ScreenId) => {
    if (!isScreenAllowedForRole(screen, role, rhAllowed, faltasAtestados.allowed, rhMatriculas.allowed)) {
      if (role === 'promotor') {
        navigate(screenPath('portal-promotor'), { replace: true });
      } else if (role === 'client_industry') {
        navigate(screenPath('portal-industria'), { replace: true });
      }
      return;
    }
    navigate(screenPath(screen));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const currentScreenAllowed = isScreenAllowedForRole(currentScreen, role, rhAllowed, faltasAtestados.allowed, rhMatriculas.allowed);
  const activeScreen = currentScreenAllowed
    ? currentScreen
    : homeScreen;

  useEffect(() => {
    if (accessCheckPending) return;
    if (!requestedScreen || !currentScreenAllowed) {
      navigate(screenPath(activeScreen), { replace: true });
    }
  }, [accessCheckPending, requestedScreen, currentScreenAllowed, activeScreen, navigate]);

  if (accessCheckPending) {
    return <div className="min-h-screen bg-[#E4E2DB] flex items-center justify-center text-[#171717] font-mono text-xs">Verificando permissões...</div>;
  }

  return (
    <AppShell
      currentScreen={activeScreen}
      onNavigate={handleNavigate}
      toasts={toasts}
      onDismissToast={dismissToast}
    >
      <Suspense fallback={<div className="flex min-h-48 items-center justify-center text-sm text-neutral-500">Carregando tela...</div>}>
      {activeScreen === 'faltas-atestados' && <FaltasAtestadosModule />}
      {activeScreen === 'rh-matriculas' && <RhMatriculasReconciliationView />}
      {activeScreen === 'rh-ausencias' && <RhAbsencesView />}
      {activeScreen === 'cockpit' && (
        <CockpitView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'painel-operacional' && (
        <OperationalDashboardView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'acompanhamento-visitas' && (
        <VisitsTrackingView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'presenca' && (
        <AttendanceControlView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'rotas-fixas' && (
        <RoutesView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'industrias' && (
        <IndustriesView onShowToast={addToast} />
      )}
      {activeScreen === 'lojas' && (
        <StoresView onShowToast={addToast} />
      )}
      {activeScreen === 'portal-promotor' && (
        <PromoterPortalView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'portal-industria' && (
        <IndustryPortalView onShowToast={addToast} />
      )}
      {activeScreen === 'gestao-equipes' && (
        <TeamsManagementView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'supervisores' && (
        <SupervisorsManagementView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'freelancers' && (
        <FreelancersView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'controle-diarias' && (
        <DailiesControlView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'promotores' && (
        <PromotersView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'importacao' && (
        <ImportView onShowToast={addToast} />
      )}
      {activeScreen === 'design-system' && (
        <DesignSystemView onShowToast={addToast} />
      )}
      {activeScreen === 'usuarios' && (
        <UsersPermissionsView onShowToast={addToast} />
      )}
      {activeScreen === 'meu-perfil' && (
        <ProfileView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      </Suspense>
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RhAccessProvider>
      <FaltasAtestadosAccessProvider>
      <RhMatriculasAccessProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/*" element={<Dashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </RhMatriculasAccessProvider>
      </FaltasAtestadosAccessProvider>
      </RhAccessProvider>
    </AuthProvider>
  );
}
