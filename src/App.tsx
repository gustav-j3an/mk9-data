import React, { useState, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ScreenId, ToastMessage } from './types';
import { AppShell } from './components/AppShell';
import { CockpitView } from './views/CockpitView';
import { OperationalDashboardView } from './views/OperationalDashboardView';
import { AttendanceControlView } from './views/AttendanceControlView';
import { TeamsManagementView } from './views/TeamsManagementView';
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
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { ProtectedRoute } from './auth/ProtectedRoute';

function isScreenAllowedForRole(screen: ScreenId, role: string): boolean {
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
  const [currentScreen, setCurrentScreen] = useState<ScreenId>(
    role === 'promotor' ? 'portal-promotor' : role === 'client_industry' ? 'portal-industria' : 'cockpit'
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    if (role === 'promotor' && currentScreen !== 'portal-promotor') {
      setCurrentScreen('portal-promotor');
    } else if (role === 'client_industry' && currentScreen !== 'portal-industria') {
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
    if (!isScreenAllowedForRole(screen, role)) {
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

  const activeScreen = isScreenAllowedForRole(currentScreen, role)
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
      {activeScreen === 'cockpit' && (
        <CockpitView onNavigate={handleNavigate} onShowToast={addToast} />
      )}
      {activeScreen === 'painel-operacional' && (
        <OperationalDashboardView onNavigate={handleNavigate} onShowToast={addToast} />
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
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/*" element={<Dashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
