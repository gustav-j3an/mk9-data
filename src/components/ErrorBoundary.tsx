import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const CHUNK_RELOAD_KEY = 'mk9_chunk_reload_timestamp';
const RELOAD_COOLDOWN_MS = 15000; // 15 segundos para evitar loop infinito de recargas

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[MK9 ErrorBoundary] Uncaught runtime exception:', error, errorInfo);
    this.setState({ errorInfo });

    // Detecção de falhas de carregamento de chunks / scripts desatualizados
    const isChunkLoadFailed =
      error?.message?.includes('Failed to fetch dynamically imported module') ||
      error?.message?.includes('Importing a module script failed') ||
      error?.name === 'ChunkLoadError' ||
      error?.message?.includes('Loading chunk');

    if (isChunkLoadFailed) {
      const lastReload = sessionStorage.getItem(CHUNK_RELOAD_KEY);
      const now = Date.now();
      const shouldReload = !lastReload || now - parseInt(lastReload, 10) > RELOAD_COOLDOWN_MS;

      if (shouldReload) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, now.toString());
        console.warn('[MK9 ErrorBoundary] Chunk desatualizado detectado. Recarregando página com nova versão...');
        window.location.reload();
      }
    }
  }

  private handleRetry = () => {
    // Tenta resetar o estado de erro e recarregar a interface
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.assign('/');
  };

  public render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-[#EAE8E2] text-[#171717] flex items-center justify-center p-4 font-sans selection:bg-[#111114] selection:text-white">
          <section className="w-full max-w-lg rounded-2xl border border-[#CFCDC5] bg-[#F7F6F2] p-6 sm:p-8 shadow-xl">
            {/* Header Brand */}
            <div className="mb-6 flex items-center justify-between pb-4 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-[#111114] text-white flex items-center justify-center font-extrabold text-sm tracking-tight shadow-sm">
                  MK
                </div>
                <div>
                  <h1 className="text-base font-extrabold tracking-tight text-[#171717]">MK9 DATE</h1>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#737373] font-mono">
                    Trade Marketing Operations
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-[#FBEAE9] text-[#C62828] font-mono text-[10px] font-bold border border-[#F5C2C0]">
                Recuperação de Falha
              </span>
            </div>

            {/* Content Info */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[#C62828]">
                <span className="material-symbols-outlined text-2xl">error</span>
                <h2 className="text-lg font-extrabold text-[#171717]">Não foi possível inicializar esta tela</h2>
              </div>
              <p className="text-xs sm:text-sm text-[#737373] leading-relaxed">
                A aplicação detectou uma interrupção inesperada ao carregar os recursos. Isso pode acontecer após a publicação de uma nova versão ou instabilidade passageira de rede.
              </p>

              {this.state.error?.message && (
                <div className="mt-3 p-3 rounded-lg bg-[#EAE8E2] border border-[#CFCDC5] text-[11px] font-mono text-[#525252] break-words max-h-24 overflow-y-auto">
                  <span className="font-bold text-[#171717]">Detalhe técnico: </span>
                  {this.state.error.message}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={this.handleRetry}
                className="w-full sm:flex-1 h-11 rounded-lg bg-[#111114] hover:bg-black text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                Recarregar Aplicação
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                className="w-full sm:w-auto px-5 h-11 rounded-lg bg-[#E4E2DB] hover:bg-[#DCDAD2] text-[#171717] border border-[#CFCDC5] text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">home</span>
                Início
              </button>
            </div>

            <p className="mt-4 text-[10px] text-center text-[#737373] font-mono">
              Sua sessão e seus dados salvos continuam seguros e preservados.
            </p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
