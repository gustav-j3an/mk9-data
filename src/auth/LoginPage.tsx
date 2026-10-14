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

  const isFirstAccess = Boolean(session?.user?.user_metadata?.must_change_password);

  useEffect(() => {
    if (session && !isPasswordRecovery) {
      navigate('/', { replace: true });
    }
  }, [session, isPasswordRecovery, navigate]);

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
        text: 'E-mail de recuperação enviado com sucesso! Verifique sua caixa de entrada.',
        type: 'success'
      });
    }
  }

  return (
    <main className="min-h-screen bg-[#EAE8E2] text-[#171717] flex items-center justify-center px-6 font-sans">
      <section className="w-full max-w-md rounded-2xl border border-[#CFCDC5] bg-[#F7F6F2] p-8 shadow-xl">
        <div className="mb-8 flex items-center justify-between pb-4 border-b border-[#CFCDC5]">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-extrabold tracking-tight text-[#171717]">MK9</span>
            <span className="text-xs font-bold text-[#286FF5] tracking-widest font-mono uppercase bg-[#EBF2FE] px-2 py-0.5 rounded border border-[#C3D9FD]">
              DATE
            </span>
          </div>
          <span className="text-[10px] font-bold text-[#737373] tracking-widest uppercase font-mono">
            TRADE OPS
          </span>
        </div>

        {!configured && (
          <div className="mb-6 rounded-lg border border-[#FCE19B] bg-[#FFF8E6] p-3 text-xs text-[#D98A00] font-mono">
            Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no `.env.local` para ativar o login.
          </div>
        )}

        {message && (
          <div
            className={`mb-6 rounded-lg border p-3 text-xs font-medium ${
              message.type === 'error'
                ? 'border-[#F8C8C8] bg-[#FDF2F2] text-[#D93636]'
                : 'border-[#B9E5D0] bg-[#E8F5EE] text-[#16845B]'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* MODE A: Primeiro Acesso */}
        {isFirstAccess ? (
          <div>
            <div className="flex items-center gap-2 text-[#D98A00] mb-1">
              <span className="material-symbols-outlined text-lg">shield_lock</span>
              <span className="text-xs font-mono uppercase tracking-wider font-bold">Primeiro Acesso</span>
            </div>
            <h2 className="text-xl font-bold text-[#171717]">Crie sua nova senha</h2>
            <p className="mt-1 text-xs text-[#737373]">
              Cadastre sua senha pessoal definitiva para acessar a plataforma.
            </p>

            <form onSubmit={handleSaveNewPassword} className="mt-6 space-y-4 text-xs font-mono">
              <label className="block text-[#171717] font-semibold">
                Nova senha (mínimo 6 caracteres)
                <input
                  required
                  type="password"
                  minLength={6}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="••••••••"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#EAE8E2] px-3 text-xs text-[#171717] outline-none focus:border-[#111114] focus:bg-white font-sans"
                />
              </label>

              <label className="block text-[#171717] font-semibold">
                Confirmar nova senha
                <input
                  required
                  type="password"
                  minLength={6}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="••••••••"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#EAE8E2] px-3 text-xs text-[#171717] outline-none focus:border-[#111114] focus:bg-white font-sans"
                />
              </label>

              <button
                disabled={!configured || submitting}
                className="h-10 w-full rounded-lg bg-[#111114] hover:bg-black text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {submitting ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          </div>
        ) : isPasswordRecovery ? (
          /* MODE B: Redefinição de Senha */
          <div>
            <h2 className="text-xl font-bold text-[#171717]">Redefinir senha</h2>
            <p className="mt-1 text-xs text-[#737373]">Cadastre uma nova senha de acesso para sua conta MK9.</p>

            <form onSubmit={handleSaveNewPassword} className="mt-6 space-y-4 text-xs font-mono">
              <label className="block text-[#171717] font-semibold">
                Nova senha (mínimo 6 caracteres)
                <input
                  required
                  type="password"
                  minLength={6}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="••••••••"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#EAE8E2] px-3 text-xs text-[#171717] outline-none focus:border-[#111114] focus:bg-white font-sans"
                />
              </label>

              <label className="block text-[#171717] font-semibold">
                Confirmar nova senha
                <input
                  required
                  type="password"
                  minLength={6}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="••••••••"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#EAE8E2] px-3 text-xs text-[#171717] outline-none focus:border-[#111114] focus:bg-white font-sans"
                />
              </label>

              <button
                disabled={!configured || submitting}
                className="h-10 w-full rounded-lg bg-[#111114] hover:bg-black text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {submitting ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          </div>
        ) : isForgotMode ? (
          /* MODE C: Recuperar Senha */
          <div>
            <h2 className="text-xl font-bold text-[#171717]">Recuperar senha</h2>
            <p className="mt-1 text-xs text-[#737373]">Informe seu e-mail para receber o link de redefinição.</p>

            <form onSubmit={handleForgotPasswordRequest} className="mt-6 space-y-4 text-xs font-mono">
              <label className="block text-[#171717] font-semibold">
                E-mail cadastrado
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seuemail@mk9.com"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#EAE8E2] px-3 text-xs text-[#171717] outline-none focus:border-[#111114] focus:bg-white font-sans"
                />
              </label>

              <button
                disabled={!configured || submitting}
                className="h-10 w-full rounded-lg bg-[#111114] hover:bg-black text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {submitting ? 'Enviando...' : 'Enviar e-mail de recuperação'}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotMode(false);
                    setMessage(null);
                  }}
                  className="text-xs text-[#737373] hover:text-[#171717] transition cursor-pointer font-sans"
                >
                  Voltar para o login
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* MODE D: Login Normal */
          <div>
            <h2 className="text-xl font-bold text-[#171717]">Entrar no sistema</h2>
            <p className="mt-1 text-xs text-[#737373]">Acesse sua conta operacional com segurança.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-xs font-mono">
              <label className="block text-[#171717] font-semibold">
                E-mail
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seuemail@mk9.com"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#EAE8E2] px-3 text-xs text-[#171717] outline-none focus:border-[#111114] focus:bg-white font-sans"
                />
              </label>
              
              <label className="block text-[#171717] font-semibold">
                <div className="flex items-center justify-between">
                  <span>Senha</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotMode(true);
                      setMessage(null);
                    }}
                    className="text-xs text-[#286FF5] hover:underline transition font-sans cursor-pointer"
                  >
                    Esqueci minha senha
                  </button>
                </div>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#EAE8E2] px-3 text-xs text-[#171717] outline-none focus:border-[#111114] focus:bg-white font-sans"
                />
              </label>
              
              <button
                disabled={!configured || submitting}
                className="h-10 w-full rounded-lg bg-[#111114] hover:bg-black text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {submitting ? 'Entrando...' : 'Entrar na Plataforma'}
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
