import { FormEvent, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { signOutAndNavigateToLogin } from './firstAccessNavigation';

function FirstAccessForm() {
  const { configured, updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleReturnToLogin() {
    setMessage(null);
    setSubmitting(true);
    try {
      await signOutAndNavigateToLogin(
        signOut,
        () => {
          setNewPassword('');
          setConfirmPassword('');
        },
        navigate
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Erro desconhecido';
      setMessage({ text: `Não foi possível encerrar a sessão: ${detail}`, type: 'error' });
      setSubmitting(false);
    }
  }

  async function handleSaveNewPassword(event: FormEvent) {
    event.preventDefault();
    setMessage(null);

    if (!newPassword || newPassword.length < 6) {
      setMessage({ text: 'A nova senha deve ter no mínimo 6 caracteres.', type: 'error' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ text: 'As senhas não coincidem. Digite novamente.', type: 'error' });
      return;
    }

    setSubmitting(true);
    const { error } = await updatePassword(newPassword);
    setSubmitting(false);

    if (error) {
      setMessage({ text: `Erro ao salvar nova senha: ${error.message}`, type: 'error' });
    } else {
      setMessage({ text: 'Senha cadastrada com sucesso! Entrando no sistema...', type: 'success' });
    }
  }

  return (
    <main className="min-h-screen bg-[#E4E2DB] text-[#171717] flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-2xl border border-[#CFCDC5] bg-[#F7F6F2] p-8 shadow-2xl shadow-purple-950/30">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-extrabold shadow-[0_0_18px_rgba(147,51,234,0.55)]">
            MK
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-wide">MK9 COMMAND CENTER</h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-400">Trade Marketing Ops</p>
          </div>
        </div>

        {message && (
          <div
            className={`mb-6 rounded-lg border p-3 text-xs ${
              message.type === 'error'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 text-amber-400 mb-1">
            <span className="material-symbols-outlined text-lg">shield_lock</span>
            <span className="text-xs font-mono uppercase tracking-wider font-bold">Primeiro Acesso</span>
          </div>
          <h2 className="text-2xl font-bold">Por segurança, crie sua nova senha</h2>
          <p className="mt-2 text-sm text-[#77766F]">
            Você está acessando com uma senha temporária. Cadastre sua senha pessoal definitiva para continuar.
          </p>

          <form onSubmit={handleSaveNewPassword} className="mt-6 space-y-4">
            <label className="block text-sm text-[#171717]">
              Nova senha (mínimo 6 caracteres)
              <input
                required
                type="password"
                minLength={6}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="••••••••"
                className="mt-2 h-11 w-full rounded-lg border border-[#CFCDC5] bg-[#E4E2DB] px-3 text-sm outline-none focus:border-purple-500"
              />
            </label>

            <label className="block text-sm text-[#171717]">
              Confirmar nova senha
              <input
                required
                type="password"
                minLength={6}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="••••••••"
                className="mt-2 h-11 w-full rounded-lg border border-[#CFCDC5] bg-[#E4E2DB] px-3 text-sm outline-none focus:border-purple-500"
              />
            </label>

            <button
              disabled={!configured || submitting}
              className="h-11 w-full rounded-lg bg-purple-600 text-sm font-bold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Salvando nova senha...' : 'Salvar nova senha'}
            </button>
          </form>
          <button
            type="button"
            disabled={submitting}
            onClick={handleReturnToLogin}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-[#4B5563] transition hover:bg-[#EAE8E2] hover:text-[#171717] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden="true" className="text-base">←</span>
            Voltar para o login
          </button>
        </div>
      </section>
    </main>
  );
}

export function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen bg-[#E4E2DB] flex items-center justify-center text-[#171717] font-mono text-xs">Carregando sessão...</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
  }

  if (session.user?.user_metadata?.must_change_password) {
    return <FirstAccessForm />;
  }

  return <Outlet />;
}
