import React, { useState } from 'react';
import { ScreenId, ToastMessage, UserRole } from '../types';
import { useAuth } from '../auth/AuthProvider';

interface AppShellProps {
  currentScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  children: React.ReactNode;
  toasts: ToastMessage[];
  onDismissToast: (id: string) => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentScreen,
  onNavigate,
  children,
  toasts,
  onDismissToast
}) => {
  const { session, profile, role, signOut, hasPermission } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const navItems = [
    {
      group: 'OPERAÇÕES CENTRAIS',
      items: [
        { id: 'cockpit' as ScreenId, label: 'Cockpit', icon: 'speed', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'painel-operacional' as ScreenId, label: 'Painel Operacional', icon: 'monitoring', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'gestao-equipes' as ScreenId, label: 'Gestão de Equipes', icon: 'groups', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'CAMPO & ROTAS',
      items: [
        { id: 'portal-promotor' as ScreenId, label: 'Portal do Promotor', icon: 'smartphone', roles: ['admin', 'gestor', 'operador', 'promotor'] as UserRole[] },
        { id: 'presenca' as ScreenId, label: 'Controle de Presença', icon: 'how_to_reg', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'rotas-fixas' as ScreenId, label: 'Rotas Fixas', icon: 'alt_route', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'CADASTROS',
      items: [
        { id: 'industrias' as ScreenId, label: 'Indústrias', icon: 'factory', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'lojas' as ScreenId, label: 'Lojas / PDVs', icon: 'store', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'promotores' as ScreenId, label: 'Promotores', icon: 'badge', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'freelancers' as ScreenId, label: 'Freelancers', icon: 'engineering', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'importacao' as ScreenId, label: 'Importação de Planilhas', icon: 'upload_file', roles: ['admin', 'gestor'] as UserRole[] }
      ]
    },
    {
      group: 'FINANCEIRO & AUDITORIA',
      items: [
        { id: 'controle-diarias' as ScreenId, label: 'Controle de Diárias', icon: 'payments', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'CONFIGURAÇÕES & SEGURANÇA',
      items: [
        { id: 'usuarios' as ScreenId, label: 'Perfis & Permissões', icon: 'admin_panel_settings', roles: ['admin', 'gestor'] as UserRole[] },
        { id: 'design-system' as ScreenId, label: 'Logo & Design System', icon: 'palette', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    }
  ];

  const getRoleLabel = (r: UserRole) => {
    switch (r) {
      case 'admin':
        return { text: 'Admin', color: 'text-purple-400 border-purple-500/40 bg-purple-950/60' };
      case 'gestor':
        return { text: 'Gestor', color: 'text-cyan-400 border-cyan-500/40 bg-cyan-950/60' };
      case 'operador':
        return { text: 'Operador', color: 'text-emerald-400 border-emerald-500/40 bg-emerald-950/60' };
      case 'promotor':
        return { text: 'Promotor', color: 'text-amber-400 border-amber-500/40 bg-amber-950/60' };
    }
  };

  const roleInfo = getRoleLabel(role);

  return (
    <div className="bg-[#0f131d] text-slate-100 min-h-screen flex flex-col font-sans">
      {/* MOBILE BACKDROP */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* SIDEBAR NAVIGATION */}
      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-[#0a0d14] border-r border-[#1e2433] z-50 flex flex-col justify-between overflow-y-auto transition-transform duration-300 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex flex-col">
          {/* Brand Header */}
          <div
            onClick={() => onNavigate(role === 'promotor' ? 'portal-promotor' : 'cockpit')}
            className="h-16 px-5 flex items-center gap-3 border-b border-[#1e2433] bg-[#0a0d14]/90 backdrop-blur-xl cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(147,51,234,0.6)] group-hover:scale-105 transition-transform">
              <span className="text-xs tracking-wider font-extrabold font-mono">MK</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-extrabold text-white tracking-wide uppercase">
                MK9 COMMAND
              </span>
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider font-mono">
                TRADE MARKETING OPS
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="py-4 px-3 space-y-5">
            {navItems.map((section) => {
              const visibleItems = section.items.filter((item) => !item.roles || hasPermission(item.roles));
              if (visibleItems.length === 0) return null;

              return (
                <div key={section.group}>
                  <div className="px-2 pb-1.5 text-[10px] font-bold text-slate-500 tracking-wider uppercase font-mono">
                    {section.group}
                  </div>
                  <nav className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const isActive = currentScreen === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            onNavigate(item.id);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                            isActive
                              ? 'bg-purple-600 text-white font-bold neon-purple-glow shadow-md'
                              : 'text-slate-400 hover:text-slate-100 hover:bg-[#171b26]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={`material-symbols-outlined text-[18px] ${isActive ? 'text-white' : 'text-slate-400'}`}>
                              {item.icon}
                            </span>
                            <span>{item.label}</span>
                          </div>
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          )}
                        </button>
                      );
                    })}
                  </nav>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 m-3 rounded-lg bg-[#131722] border border-[#1e2433] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 neon-green-glow" />
            <span className="font-mono text-[11px] text-slate-400">v2.5.0 Enterprise</span>
          </div>
          <span
            onClick={() => onNavigate('design-system')}
            title="Design System & Logs"
            className="material-symbols-outlined text-[16px] text-slate-500 hover:text-purple-400 cursor-pointer transition-colors"
          >
            verified_user
          </span>
        </div>
      </aside>

      {/* TOP HEADER */}
      <header className="fixed top-0 left-0 lg:left-64 right-0 h-16 bg-[#0f131d]/90 backdrop-blur-xl border-b border-[#1e2433] z-40 px-4 lg:px-6 flex items-center justify-between">
        {/* Left: Mobile hamburger & Global Search */}
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#171b26]"
            aria-label="Abrir Menu"
          >
            <span className="material-symbols-outlined text-[22px]">menu</span>
          </button>

          <div className="relative w-full max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
              search
            </span>
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Buscar promotores, PDVs, relatórios ou SKUs..."
              className="w-full h-9 pl-9 pr-14 bg-[#131722] border border-[#1e2433] rounded-lg text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition-all font-sans"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:flex items-center px-1.5 py-0.5 rounded bg-[#1f2433] border border-[#334155]/40 text-[10px] text-slate-400 font-mono pointer-events-none">
              Ctrl+K
            </div>
          </div>

          <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-[#131722] border border-emerald-500/20 shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
            </span>
            <span className="text-[11px] font-bold text-emerald-400">Operação Ao Vivo</span>
            <span className="text-slate-600 text-xs">•</span>
            <span className="font-mono text-[11px] text-slate-300">99.1% Ativa</span>
          </div>
        </div>

        {/* Right Actions & Profile */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-lg bg-[#131722] border border-[#1e2433] text-xs font-medium text-slate-300">
            <span className="material-symbols-outlined text-[16px] text-cyan-400">calendar_today</span>
            <span>Hoje, 24 de Outubro</span>
          </div>

          {/* Notification Button & Menu */}
          <div className="relative">
            <button
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#171b26] transition-colors border border-transparent hover:border-[#1e2433]"
              title="Notificações Operacionais"
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
            </button>

            {notificationsOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-[#171b26] border border-[#1e2433] rounded-xl shadow-2xl p-3 z-50 animate-fadeIn">
                <div className="flex items-center justify-between pb-2 border-b border-[#1e2433]">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                    Notificações Operacionais
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">0 pendentes</span>
                </div>
                <div className="py-6 text-center text-[11px] text-slate-400">
                  Não há notificações operacionais cadastradas.
                </div>
              </div>
            )}
          </div>

          <div className="h-6 w-px bg-[#1e2433] hidden sm:block" />

          {/* Profile Badge & Logout Action */}
          <div className="flex items-center gap-3">
            <div className="flex flex-col text-right hidden sm:flex">
              <span className="text-xs font-bold text-slate-200 leading-tight">
                {profile?.promotor_nome || profile?.name || (session?.user?.email ? session.user.email.split('@')[0] : 'Usuário MK9')}
              </span>
              <div className="flex items-center justify-end gap-1.5 mt-0.5">
                {profile?.promotor_matricula && (
                  <span className="text-[10px] font-mono text-amber-400 font-bold bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.2 rounded">
                    Matrícula: {profile.promotor_matricula}
                  </span>
                )}
                <span className={`px-1.5 py-0.2 rounded border font-mono font-bold text-[9px] uppercase tracking-wider ${roleInfo.color}`}>
                  {roleInfo.text}
                </span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-purple-500/40 shadow-[0_0_12px_rgba(147,51,234,0.3)] bg-purple-900/40 flex items-center justify-center shrink-0">
              <span className="font-bold text-xs text-purple-200 uppercase">
                {(() => {
                  const n = profile?.promotor_nome || profile?.name || session?.user?.email || 'MK';
                  const parts = n.trim().split(/\s+/);
                  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                  return n.substring(0, 2).toUpperCase();
                })()}
              </span>
            </div>

            <button
              onClick={() => signOut()}
              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all flex items-center gap-1 text-xs"
              title="Sair da Conta (Logout)"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="lg:pl-64 pt-16 flex-1 flex flex-col w-full min-h-[calc(100vh-4rem)]">
        {children}
      </main>

      {/* GLOBAL TOAST CONTAINER */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto bg-[#171b26] border border-[#1e2433] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 transition-all duration-300 min-w-[300px] max-w-md animate-slideUp"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[18px]">done</span>
            </div>
            <div className="flex flex-col flex-1">
              <span className="text-xs font-bold text-slate-100">{toast.title}</span>
              <span className="text-[11px] text-slate-400 leading-tight">{toast.message}</span>
            </div>
            <button
              onClick={() => onDismissToast(toast.id)}
              className="text-slate-500 hover:text-slate-300 p-1 rounded"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
