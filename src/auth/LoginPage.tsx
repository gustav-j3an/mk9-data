import { FormEvent, useState } from 'react';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const { configured, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);
    const { error } = await signIn(email, password);
    if (error) setMessage(error.message);
    setSubmitting(false);
  }

  return (
    <main className="min-h-screen bg-[#0a0d14] text-slate-100 flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-2xl border border-[#2a3042] bg-[#111522] p-8 shadow-2xl shadow-purple-950/30">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-extrabold shadow-[0_0_18px_rgba(147,51,234,0.55)]">MK</div>
          <div>
            <h1 className="text-lg font-extrabold tracking-wide">MK9 COMMAND CENTER</h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-400">Trade Marketing Ops</p>
          </div>
        </div>
        <h2 className="text-2xl font-bold">Entrar no sistema</h2>
        <p className="mt-2 text-sm text-slate-400">Acesse seu painel operacional com segurança.</p>

        {!configured && (
          <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no `.env.local` para ativar o login.
          </div>
        )}
        {message && <div className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{message}</div>}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-sm text-slate-300">E-mail<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[#2a3042] bg-[#0a0d14] px-3 text-sm outline-none focus:border-purple-500" /></label>
          <label className="block text-sm text-slate-300">Senha<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[#2a3042] bg-[#0a0d14] px-3 text-sm outline-none focus:border-purple-500" /></label>
          <button disabled={!configured || submitting} className="h-11 w-full rounded-lg bg-purple-600 text-sm font-bold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Entrando...' : 'Entrar'}</button>
        </form>
      </section>
    </main>
  );
}
