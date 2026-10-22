import React, { useState, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ScreenId, ToastMessage } from './types';
import { AppShell } from './components/AppShell';
import { CockpitView } from './views/CockpitView';
import { OperationalDashboardView } from './views/OperationalDashboardView';
import { VisitsTrackingView } from './views/VisitsTrackingView';
import { AttendanceControlView } from './views/AttendanceControlView';
import { TeamsManagementView } from './views/TeamsManagementView';
import { SupervisorsManagementView } from './views/SupervisorsManagementView';
import { FreelancersView } from './views/FreelancersView';
import { DailiesControlView } from './views/DailiesControlView';
import { PromotersView } from './views/PromotersView';
import { DesignSystemView } from './views/DesignSystemView';
import { UsersPermissionsView } from './views/UsersPermissionsView';
import { ImportView } from './views/ImportView';
import { RoutesView } from './views/RoutesView';
import { IndustriesView } from './views/IndustriesView';
import { StoresView } from './views/StoresView';
import { PromoterPortalView } from './views/PromoterPortalView';
import { IndustryPortalView } from './views/IndustryPortalView';
import { ProfileView } from './views/ProfileView';
import { RhAbsencesView } from './views/RhAbsencesView';
import { RhAccessProvider, useRhAccess } from './lib/rhAccess';
<<<<<<< HEAD
=======
import { FaltasAtestadosAccessProvider, useFaltasAtestadosAccess } from './lib/faltasAtestadosAccess';
import { FaltasAtestadosModule } from './views/FaltasAtestadosModule';
import { RhMatriculasAccessProvider, useRhMatriculasAccess } from './lib/rhMatriculasAccess';
import { RhMatriculasReconciliationView } from './views/RhMatriculasReconciliationView';
>>>>>>> c943d2797aff85d3e3e3468cf3e80fce8aa64f40
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { ProtectedRoute } from './auth/ProtectedRoute';

<<<<<<< HEAD
function isScreenAllowedForRole(screen: ScreenId, role: string, rhAllowed = false): boolean {
=======
function isScreenAllowedForRole(screen: ScreenId, role: string, rhAllowed = false, faltasAtestadosAllowed = false, rhMatriculasAllowed = false): boolean {
  if (screen === 'faltas-atestados') return faltasAtestadosAllowed;
  if (screen === 'rh-matriculas') return role === 'admin' && rhMatriculasAllowed;
>>>>>>> c943d2797aff85d3e3e3468cf3e80fce8aa64f40
  if (screen === 'rh-ausencias') return rhAllowed;
  if (screen === 'meu-perfil') {
    return true;
  }
  if (role === 'promotor') {
    return screen === 'portal-promotor';
  }
  if (role === 'client_industry') {
    return screen === 'portal-industria';
  }
  if (role === 'operador') {
    return screen !== 'importacao' && screen !== 'usuarios';
  }
  if (role === 'gestor') {
    return screen !== 'usuarios';
  }
  return true;
}

function Dashboard() {
  const { role, profile } = useAuth();
  const rh = useRhAccess();
<<<<<<< HEAD
=======
  const faltasAtestados = useFaltasAtestadosAccess();
  const rhMatriculas = useRhMatriculasAccess();
>>>>>>> c943d2797aff85d3e3e3468cf3e80fce8aa64f40
  const rhAllowed = rh.mine || rh.team || rh.management;
  const [currentScreen, setCurrentScreen] = useState<ScreenId>(
    role === 'promotor' ? 'portal-promotor' : role === 'client_industry' ? 'portal-industria' : 'cockpit'
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    if (role === 'promotor' && !['portal-promotor', 'rh-ausencias'].includes(currentScreen)) {
      setCurrentScreen('portal-promotor');
    } else if (role === 'client_industry' && !['portal-industria', 'rh-ausencias'].includes(currentScreen)) {
      setCurrentScreen('portal-industria');
    }
  }, [role, currentScreen]);

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
<<<<<<< HEAD
    if (!isScreenAllowedForRole(screen, role, rhAllowed)) {
=======
    if (!isScreenAllowedForRole(screen, role, rhAllowed, faltasAtestados.allowed, rhMatriculas.allowed)) {
>>>>>>> c943d2797aff85d3e3e3468cf3e80fce8aa64f40
      if (role === 'promotor') {
        setCurrentScreen('portal-promotor');
      } else if (role === 'client_industry') {
        setCurrentScreen('portal-industria');
      }
      return;
    }
    setCurrentScreen(screen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

<<<<<<< HEAD
  const activeScreen = isScreenAllowedForRole(currentScreen, role, rhAllowed)
=======
  const activeScreen = isScreenAllowedForRole(currentScreen, role, rhAllowed, faltasAtestados.allowed, rhMatriculas.allowed)
>>>>>>> c943d2797aff85d3e3e3468cf3e80fce8aa64f40
    ? currentScreen
    : role === 'promotor'
    ? 'portal-promotor'
    : role === 'client_industry'
    ? 'portal-industria'
    : 'cockpit';

  return (
    <AppShell
      currentScreen={activeScreen}
      onNavigate={handleNavigate}
      toasts={toasts}
      onDismissToast={dismissToast}
    >
<<<<<<< HEAD
=======
      {activeScreen === 'faltas-atestados' && <FaltasAtestadosModule />}
      {activeScreen === 'rh-matriculas' && <RhMatriculasReconciliationView />}
>>>>>>> c943d2797aff85d3e3e3468cf3e80fce8aa64f40
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
        <PromoterPortalView onShowToast={addToast} />
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
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RhAccessProvider>
<<<<<<< HEAD
=======
      <FaltasAtestadosAccessProvider>
      <RhMatriculasAccessProvider>
>>>>>>> c943d2797aff85d3e3e3468cf3e80fce8aa64f40
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/*" element={<Dashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
<<<<<<< HEAD
=======
      </RhMatriculasAccessProvider>
      </FaltasAtestadosAccessProvider>
>>>>>>> c943d2797aff85d3e3e3468cf3e80fce8aa64f40
      </RhAccessProvider>
    </AuthProvider>
  );
}
