import { FormEvent, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const { configured, session, signIn, isPasswordRecovery, updatePassword, resetPasswordForEmail } = useAuth();
  const navigate = useNavigate();
  
  // Normal Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Password Change / Recovery state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isForgotMode, setIsForgotMode] = useState(false);
  
  // Feedback state
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Check if current user is logged in with first access flag
  const isFirstAccess = Boolean(session?.user?.user_metadata?.must_change_password);

  useEffect(() => {
    if (session && !isPasswordRecovery) {
      navigate('/', { replace: true });
    }
  }, [session, isPasswordRecovery, navigate]);

  // 1. Handle Standard Login
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);

    if (error) {
      setMessage({ text: error.message, type: 'error' });
    }
  }

  // 2. Handle Password Change (First Access or Recovery)
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
      setTimeout(() => {
        window.location.assign('/');
      }, 1200);
    }
  }

  // 3. Handle Forgot Password Request
  async function handleForgotPasswordRequest(event: FormEvent) {
    event.preventDefault();
    setMessage(null);

    if (!email || !email.includes('@')) {
      setMessage({ text: 'Informe um e-mail válido.', type: 'error' });
      return;
    }

    setSubmitting(true);
    const { error } = await resetPasswordForEmail(email);
    setSubmitting(false);

    if (error) {
      setMessage({ text: `Falha ao enviar e-mail: ${error.message}`, type: 'error' });
    } else {
      setMessage({
        text: 'E-mail de recuperação enviado com sucesso! Verifique sua caixa de entrada ou spam.',
        type: 'success'
      });
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

        {!configured && (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no `.env.local` para ativar o login.
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

        {/* MODE A: Primeiro Acesso (Obrigatório trocar senha temporária) */}
        {isFirstAccess ? (
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
        ) : isPasswordRecovery ? (
          /* MODE B: Redefinição de Senha via Link de Recuperação */
          <div>
            <h2 className="text-2xl font-bold">Redefinir senha</h2>
            <p className="mt-2 text-sm text-slate-400">Cadastre uma nova senha de acesso para sua conta MK9.</p>

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
        ) : isForgotMode ? (
          /* MODE C: Solicitar E-mail de Recuperação */
          <div>
            <h2 className="text-2xl font-bold">Recuperar senha</h2>
            <p className="mt-2 text-sm text-slate-400">Informe seu e-mail para receber o link de redefinição.</p>

            <form onSubmit={handleForgotPasswordRequest} className="mt-6 space-y-4">
              <label className="block text-sm text-slate-300">
                E-mail cadastrado
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seuemail@mk9.com"
                  className="mt-2 h-11 w-full rounded-lg border border-[#2a3042] bg-[#0a0d14] px-3 text-sm outline-none focus:border-purple-500"
                />
              </label>

              <button
                disabled={!configured || submitting}
                className="h-11 w-full rounded-lg bg-purple-600 text-sm font-bold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Enviando e-mail...' : 'Enviar e-mail de recuperação'}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotMode(false);
                    setMessage(null);
                  }}
                  className="text-xs text-slate-400 hover:text-white transition"
                >
                  Voltar para o login
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* MODE D: Login Normal */
          <div>
            <h2 className="text-2xl font-bold">Entrar no sistema</h2>
            <p className="mt-2 text-sm text-slate-400">Acesse seu painel operacional com segurança.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <label className="block text-sm text-slate-300">
                E-mail
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-[#2a3042] bg-[#0a0d14] px-3 text-sm outline-none focus:border-purple-500"
                />
              </label>
              
              <label className="block text-sm text-slate-300">
                <div className="flex items-center justify-between">
                  <span>Senha</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotMode(true);
                      setMessage(null);
                    }}
                    className="text-xs text-purple-400 hover:text-purple-300 transition"
                  >
                    Esqueci minha senha
                  </button>
                </div>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-[#2a3042] bg-[#0a0d14] px-3 text-sm outline-none focus:border-purple-500"
                />
              </label>
              
              <button
                disabled={!configured || submitting}
                className="h-11 w-full rounded-lg bg-purple-600 text-sm font-bold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
