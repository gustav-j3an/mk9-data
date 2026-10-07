import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen bg-[#0a0d14] flex items-center justify-center text-slate-300 font-mono text-xs">Carregando sessão...</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (session.user?.user_metadata?.must_change_password) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
