import React, { FormEvent, useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';

export function ResetPasswordPage() {
  const { configured, session, isPasswordRecovery, updatePassword } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const [isSessionValid, setIsSessionValid] = useState<boolean | null>(null);

  // Check if session or recovery token is active
  useEffect(() => {
    const isRecoveryInUrl =
      window.location.hash.includes('type=recovery') ||
      window.location.search.includes('type=recovery') ||
      window.location.search.includes('code=');

    if (session || isPasswordRecovery || isRecoveryInUrl) {
      setIsSessionValid(true);
    } else {
      // Check session asynchronously
      if (supabase) {
        supabase.auth.getSession().then(({ data }) => {
          if (data.session || isRecoveryInUrl) {
            setIsSessionValid(true);
          } else {
            setIsSessionValid(false);
          }
        });
      } else {
        setIsSessionValid(false);
      }
    }
  }, [session, isPasswordRecovery]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!newPassword || newPassword.length < 6) {
      setMessage({ text: 'A senha deve ter no mínimo 6 caracteres.', type: 'error' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ text: 'As senhas não coincidem. Verifique e tente novamente.', type: 'error' });
      return;
    }

    setSubmitting(true);
    const { error } = await updatePassword(newPassword);
    setSubmitting(false);

    if (error) {
      setMessage({ text: `Falha ao atualizar senha: ${error.message}`, type: 'error' });
    } else {
      setMessage({ text: 'Senha alterada com sucesso! Redirecionando para o sistema...', type: 'success' });
      setTimeout(() => {
        window.location.assign('/');
      }, 1500);
    }
  };

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

        {!configured && (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` para ativar a redefinição de senha.
          </div>
        )}

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

        {isSessionValid === false ? (
          /* Link expirado ou sessão inválida */
          <div className="space-y-4">
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200 space-y-2">
              <div className="font-bold text-sm">Link expirado ou inválido</div>
              <p>O link de redefinição de senha que você utilizou expirou ou não é mais válido.</p>
            </div>
            <button
              type="button"
              onClick={() => window.location.assign('/login')}
              className="h-11 w-full rounded-lg bg-[#131722] hover:bg-[#1f2433] text-sm font-bold text-slate-200 border border-[#2a3042] transition"
            >
              Voltar para o Login
            </button>
          </div>
        ) : (
          /* Formulário de Redefinição de Senha */
          <div>
            <h2 className="text-2xl font-bold">Redefinir senha</h2>
            <p className="mt-2 text-sm text-slate-400">Cadastre sua nova senha de acesso ao MK9.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <label className="block text-sm text-slate-300">
                Nova senha (mínimo 6 caracteres)
                <input
                  required
                  type="password"
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
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
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
        )}
      </section>
    </main>
  );
}
