import React, { useState, useEffect } from 'react';
import { ScreenId, ToastMessage, UserRole, AppNotification } from '../types';
import { useAuth } from '../auth/AuthProvider';
import { notificationService } from '../lib/notificationService';
import { supabase } from '../lib/supabase';
import { PWAInstallPrompt } from './PWAInstallPrompt';

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

  // Estados de Notificações Persistentes
  const [notificationsList, setNotificationsList] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const loadUserNotifications = async () => {
    if (!session?.user?.id) return;
    const [notifRes, countRes] = await Promise.all([
      notificationService.fetchNotifications(20),
      notificationService.getUnreadCount()
    ]);
    if (!notifRes.error) setNotificationsList(notifRes.data);
    if (!countRes.error) setUnreadCount(countRes.count);
  };

  useEffect(() => {
    if (!session?.user?.id) return;
    loadUserNotifications();

    if (!supabase) return;

    const channel = supabase
      .channel('public:notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${session.user.id}`
        },
        () => {
          loadUserNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const handleMarkAsRead = async (id: string) => {
    const { error } = await notificationService.markAsRead(id);
    if (!error) {
      setNotificationsList((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true, read_at: new Date().toISOString() } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!session?.user?.id) return;
    const { error } = await notificationService.markAllAsRead(session.user.id);
    if (!error) {
      setNotificationsList((prev) =>
        prev.map((n) => ({ ...n, read: true, read_at: new Date().toISOString() }))
      );
      setUnreadCount(0);
    }
  };

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
        { id: 'usuarios' as ScreenId, label: 'Perfis & Permissões', icon: 'admin_panel_settings', roles: ['admin'] as UserRole[] },
        { id: 'design-system' as ScreenId, label: 'Design System & Identidade', icon: 'palette', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'PORTAL EXTERNO',
      items: [
        { id: 'portal-industria' as ScreenId, label: 'Portal da Indústria', icon: 'domain', roles: ['admin', 'gestor', 'client_industry'] as UserRole[] }
      ]
    }
  ];

  const getRoleBadge = (r: UserRole) => {
    switch (r) {
      case 'admin':
        return { text: 'Admin', color: 'text-[#171717] bg-[#E4E2DB] border-[#CFCDC5]' };
      case 'gestor':
        return { text: 'Gestor', color: 'text-[#286FF5] bg-[#EBF2FE] border-[#C3D9FD]' };
      case 'operador':
        return { text: 'Operador', color: 'text-[#16845B] bg-[#E8F5EE] border-[#B9E5D0]' };
      case 'promotor':
        return { text: 'Promotor', color: 'text-[#D98A00] bg-[#FFF8E6] border-[#FCE19B]' };
      case 'client_industry':
        return { text: 'Indústria', color: 'text-[#286FF5] bg-[#EBF2FE] border-[#C3D9FD]' };
    }
  };

  const roleInfo = getRoleBadge(role);

  return (
    <div className="bg-[#EAE8E2] text-[#171717] min-h-screen flex flex-col font-sans selection:bg-[#111114] selection:text-[#171717]">
      {/* MOBILE BACKDROP */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-[#171717]/40 backdrop-blur-xs z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* SIDEBAR NAVIGATION - ArtCraft / GridCraft Clean Desktop Light Architecture */}
      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-[#F7F6F2] border-r border-[#CFCDC5] z-50 flex flex-col justify-between overflow-y-auto transition-transform duration-200 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex flex-col">
          {/* Brand Header */}
          <div
            onClick={() => onNavigate(role === 'promotor' ? 'portal-promotor' : 'cockpit')}
            className="h-16 px-5 flex items-center gap-3 border-b border-[#CFCDC5] bg-[#F7F6F2] cursor-pointer group select-none"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl font-extrabold tracking-tight text-[#171717] font-sans">
                MK9
              </span>
              <span className="text-xs font-bold text-[#286FF5] tracking-widest font-mono uppercase bg-[#EBF2FE] px-1.5 py-0.5 rounded border border-[#C3D9FD]">
                DATE
              </span>
            </div>
            <span className="text-[10px] text-[#737373] font-mono tracking-tight ml-auto hidden sm:inline">
              TRADE OPS
            </span>
          </div>

          {/* Navigation Links */}
          <div className="py-4 px-3 space-y-5">
            {navItems.map((section) => {
              const visibleItems = section.items.filter((item) => !item.roles || hasPermission(item.roles));
              if (visibleItems.length === 0) return null;

              return (
                <div key={section.group}>
                  <div className="px-2 pb-1.5 text-[10px] font-bold text-[#737373] tracking-wider uppercase font-mono">
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
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
                            isActive
                              ? 'bg-[#111114] text-white font-semibold shadow-xs'
                              : 'text-[#525252] hover:text-[#171717] hover:bg-[#E4E2DB]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={`material-symbols-outlined text-[18px] ${isActive ? 'text-white' : 'text-[#737373]'}`}>
                              {item.icon}
                            </span>
                            <span>{item.label}</span>
                          </div>
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#286FF5]" />
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
        <div className="p-3 m-3 rounded-lg bg-[#E4E2DB] border border-[#CFCDC5] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-[#16845B]" />
            <span className="font-mono text-[11px] text-[#737373] font-medium">v2.5.0 GridCraft</span>
          </div>
          <span
            onClick={() => onNavigate('design-system')}
            title="Design System & Tokens"
            className="material-symbols-outlined text-[16px] text-[#737373] hover:text-[#171717] cursor-pointer transition-colors"
          >
            verified_user
          </span>
        </div>
      </aside>

      {/* TOP HEADER - ArtCraft Clean Technical Toolbar */}
      <header className="fixed top-0 left-0 lg:left-64 right-0 h-16 bg-[#F7F6F2] border-b border-[#CFCDC5] z-40 px-4 lg:px-6 flex items-center justify-between">
        {/* Left: Mobile hamburger & Global Search */}
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#E4E2DB] cursor-pointer"
            aria-label="Abrir Menu"
          >
            <span className="material-symbols-outlined text-[22px]">menu</span>
          </button>

          <div className="relative w-full max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#737373] text-[18px]">
              search
            </span>
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Buscar promotores, lojas, indústrias, rotas ou relatórios..."
              className="w-full h-9 pl-9 pr-14 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] placeholder:text-[#737373] focus:outline-none focus:border-[#111114] focus:bg-white transition-all font-sans"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:flex items-center px-1.5 py-0.5 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-[10px] text-[#737373] font-mono pointer-events-none">
              Ctrl+K
            </div>
          </div>

          <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8F5EE] border border-[#B9E5D0] shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#16845B]"></span>
            </span>
            <span className="text-[11px] font-bold text-[#16845B]">Operação Ativa</span>
          </div>
        </div>

        {/* Right Actions & Profile */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5] text-xs font-medium text-[#525252]">
            <span className="material-symbols-outlined text-[16px] text-[#286FF5]">calendar_today</span>
            <span>{`Hoje, ${new Date().getDate()} de ${new Date().toLocaleDateString('pt-BR', { month: 'long' }).replace(/^./, (c) => c.toUpperCase())}`}</span>
          </div>

          {/* Notification Button & Drawer */}
          <div className="relative">
            <button
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="relative p-2 rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#E4E2DB] transition-colors border border-transparent hover:border-[#CFCDC5] cursor-pointer"
              title="Notificações Operacionais"
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#D93636] text-[9px] font-bold text-[#171717] font-mono">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl shadow-xl p-4 z-50 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[#CFCDC5]">
                  <span className="text-xs font-bold text-[#171717] flex items-center gap-1.5 font-mono">
                    <span className={`w-2 h-2 rounded-full ${unreadCount > 0 ? 'bg-[#D93636]' : 'bg-[#CFCDC5]'}`}></span>
                    Notificações Operacionais
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#737373] font-mono font-bold">
                      {unreadCount} não lida(s)
                    </span>
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllAsRead}
                        className="text-[10px] text-[#286FF5] hover:underline font-mono cursor-pointer"
                      >
                        Marcar todas
                      </button>
                    )}
                  </div>
                </div>

                {notificationsList.length === 0 ? (
                  <div className="py-8 text-center space-y-1">
                    <span className="material-symbols-outlined text-[#737373] text-2xl block">notifications_off</span>
                    <p className="text-[11px] text-[#737373] font-sans">
                      Não há notificações operacionais registradas.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-2 pr-1 divide-y divide-[#CFCDC5]">
                    {notificationsList.map((notif) => {
                      const isCritico = notif.prioridade === 'critico';
                      const isAtencao = notif.prioridade === 'atencao';

                      return (
                        <div
                          key={notif.id}
                          onClick={() => !notif.read && handleMarkAsRead(notif.id)}
                          className={`pt-2 transition-colors cursor-pointer rounded-lg p-2 ${
                            notif.read
                              ? 'opacity-60 bg-transparent hover:bg-[#E4E2DB]'
                              : 'bg-white border-l-2 border-[#286FF5] hover:bg-[#EAE8E2]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase font-mono ${
                                  isCritico
                                    ? 'bg-[#FDF2F2] text-[#D93636] border border-[#F8C8C8]'
                                    : isAtencao
                                    ? 'bg-[#FFF8E6] text-[#D98A00] border border-[#FCE19B]'
                                    : 'bg-[#EBF2FE] text-[#286FF5] border border-[#C3D9FD]'
                                }`}
                              >
                                {notif.prioridade}
                              </span>
                              <h4 className="text-xs font-bold text-[#171717] font-sans truncate">
                                {notif.titulo}
                              </h4>
                            </div>
                            {!notif.read && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#286FF5] shrink-0 mt-1"></span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#525252] mt-1 line-clamp-2 font-sans">
                            {notif.mensagem}
                          </p>
                          <span className="text-[9px] text-[#737373] font-mono block mt-1">
                            {new Date(notif.created_at).toLocaleString('pt-BR')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="h-6 w-px bg-[#CFCDC5] hidden sm:block" />

          {/* Profile & Logout Action */}
          <div className="flex items-center gap-3">
            <div className="flex flex-col text-right hidden sm:flex">
              <span className="text-xs font-bold text-[#171717] leading-tight">
                {profile?.promotor_nome || profile?.name || (session?.user?.email ? session.user.email.split('@')[0] : 'Usuário MK9')}
              </span>
              <div className="flex items-center justify-end gap-1.5 mt-0.5">
                {profile?.promotor_matricula && (
                  <span className="text-[10px] font-mono text-[#737373] font-bold bg-[#E4E2DB] border border-[#CFCDC5] px-1.5 py-0.2 rounded">
                    Matrícula: {profile.promotor_matricula}
                  </span>
                )}
                <span className={`px-1.5 py-0.2 rounded border font-mono font-bold text-[9px] uppercase tracking-wider ${roleInfo.color}`}>
                  {roleInfo.text}
                </span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-full bg-[#111114] text-white flex items-center justify-center shrink-0 border border-[#CFCDC5]">
              <span className="font-bold text-xs uppercase font-mono">
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
              className="p-2 rounded-lg text-[#737373] hover:text-[#D93636] hover:bg-[#FDF2F2] border border-transparent hover:border-[#F8C8C8] transition-all flex items-center gap-1 text-xs cursor-pointer"
              title="Sair da Conta (Logout)"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="lg:pl-64 pt-16 flex-1 flex flex-col w-full min-h-[calc(100vh-4rem)] bg-[#EAE8E2]">
        {children}
      </main>

      {/* GLOBAL TOAST CONTAINER */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto bg-[#F7F6F2] border border-[#CFCDC5] px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 transition-all duration-300 min-w-[300px] max-w-md"
          >
            <div className="w-8 h-8 rounded-full bg-[#E8F5EE] text-[#16845B] border border-[#B9E5D0] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[18px]">done</span>
            </div>
            <div className="flex flex-col flex-1">
              <span className="text-xs font-bold text-[#171717]">{toast.title}</span>
              <span className="text-[11px] text-[#737373] leading-tight">{toast.message}</span>
            </div>
            <button
              onClick={() => onDismissToast(toast.id)}
              className="text-[#737373] hover:text-[#171717] p-1 rounded cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        ))}
      </div>

      {/* PWA INSTALLATION PROMPT BANNER */}
      <PWAInstallPrompt />
    </div>
  );
};
