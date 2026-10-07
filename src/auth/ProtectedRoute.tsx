import { FormEvent, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

function FirstAccessForm() {
  const { configured, updatePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <main className="min-h-screen bg-[#0a0d14] text-slate-100 flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-2xl border border-[#2a3042] bg-[#111522] p-8 shadow-2xl shadow-purple-950/30">
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
          <p className="mt-2 text-sm text-slate-400">
            Você está acessando com uma senha temporária. Cadastre sua senha pessoal definitiva para continuar.
          </p>

          <form onSubmit={handleSaveNewPassword} className="mt-6 space-y-4">
            <label className="block text-sm text-slate-300">
              Nova senha (mínimo 6 caracteres)
              <input
                required
                type="password"
                minLength={6}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="••••••••"
                className="mt-2 h-11 w-full rounded-lg border border-[#2a3042] bg-[#0a0d14] px-3 text-sm outline-none focus:border-purple-500"
              />
            </label>

            <label className="block text-sm text-slate-300">
              Confirmar nova senha
              <input
                required
                type="password"
                minLength={6}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="••••••••"
                className="mt-2 h-11 w-full rounded-lg border border-[#2a3042] bg-[#0a0d14] px-3 text-sm outline-none focus:border-purple-500"
              />
            </label>

            <button
              disabled={!configured || submitting}
              className="h-11 w-full rounded-lg bg-purple-600 text-sm font-bold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Salvando nova senha...' : 'Salvar nova senha'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

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
    return <FirstAccessForm />;
  }

  return <Outlet />;
}
