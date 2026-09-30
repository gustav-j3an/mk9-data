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
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';

function Dashboard() {
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('cockpit');
  const [toasts, setToasts] = useState<ToastMessage[]>([
    {
      id: 'init-toast',
      title: 'Sistema Conectado',
      message: 'MK9 Command Center sincronizado com 4.820 PDVs.',
      type: 'success'
    }
  ]);

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

  return (
    <AppShell
      currentScreen={currentScreen}
      onNavigate={(screen) => {
        setCurrentScreen(screen);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      toasts={toasts}
      onDismissToast={dismissToast}
    >
      {currentScreen === 'cockpit' && (
        <CockpitView onNavigate={setCurrentScreen} onShowToast={addToast} />
      )}
      {currentScreen === 'painel-operacional' && (
        <OperationalDashboardView onNavigate={setCurrentScreen} onShowToast={addToast} />
      )}
      {currentScreen === 'presenca' && (
        <AttendanceControlView onNavigate={setCurrentScreen} onShowToast={addToast} />
      )}
      {currentScreen === 'gestao-equipes' && (
        <TeamsManagementView onNavigate={setCurrentScreen} onShowToast={addToast} />
      )}
      {currentScreen === 'freelancers' && (
        <FreelancersView onNavigate={setCurrentScreen} onShowToast={addToast} />
      )}
      {currentScreen === 'controle-diarias' && (
        <DailiesControlView onNavigate={setCurrentScreen} onShowToast={addToast} />
      )}
      {currentScreen === 'promotores' && (
        <PromotersView onNavigate={setCurrentScreen} onShowToast={addToast} />
      )}
      {currentScreen === 'design-system' && (
        <DesignSystemView onShowToast={addToast} />
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
          <Route element={<ProtectedRoute />}>
            <Route path="/*" element={<Dashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
