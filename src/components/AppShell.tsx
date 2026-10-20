import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ScreenId, ToastMessage, UserRole, AppNotification } from '../types';
import { useAuth } from '../auth/AuthProvider';
import { notificationService } from '../lib/notificationService';
import { supabase } from '../lib/supabase';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { AuthorSignature } from './AuthorSignature';
import { useRhAccess } from '../lib/rhAccess';

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
  const rh = useRhAccess();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{
    promotores: Array<{ id: string; title: string; subtitle: string; target: ScreenId }>;
    lojas: Array<{ id: string; title: string; subtitle: string; target: ScreenId }>;
    industrias: Array<{ id: string; title: string; subtitle: string; target: ScreenId }>;
    equipes: Array<{ id: string; title: string; subtitle: string; target: ScreenId }>;
    rotas: Array<{ id: string; title: string; subtitle: string; target: ScreenId }>;
  }>({
    promotores: [],
    lojas: [],
    industrias: [],
    equipes: [],
    rotas: []
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchSeqRef = useRef<number>(0);

  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Estados de Notificações Persistentes
  const [notificationsList, setNotificationsList] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // Atalho Ctrl+K ou Cmd+K para focar e abrir a pesquisa global
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      } else if (e.key === 'Escape') {
        setSearchFocused(false);
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fechar ao clicar fora do container de pesquisa
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search query contra Supabase
  useEffect(() => {
    const term = globalSearch.trim();
    if (!term || term.length < 2) {
      setSearchResults({ promotores: [], lojas: [], industrias: [], equipes: [], rotas: [] });
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    const seq = ++searchSeqRef.current;

    const timer = setTimeout(async () => {
      if (!supabase) {
        setSearchLoading(false);
        return;
      }

      try {
        const pattern = `%${term}%`;
        const canViewOps = hasPermission(['admin', 'gestor', 'operador']);
        const canViewPromoters = hasPermission(['admin', 'gestor', 'operador', 'promotor']);
        const isClientIndustry = role === 'client_industry';

        // 1. Promotores
        const promotoresPromise = canViewPromoters
          ? (async () => {
              let q = supabase
                .from('promotores')
                .select('id, matricula, nome, cidade, uf, equipe')
                .or(`nome.ilike.${pattern},matricula.ilike.${pattern},cidade.ilike.${pattern}`)
                .limit(5);

              // Se promotor, RLS limita a si próprio
              const { data } = await q;
              return (data || []).map((p: any) => ({
                id: p.id || p.matricula,
                title: p.nome || p.matricula,
                subtitle: `Matrícula: ${p.matricula} • ${p.cidade || ''}/${p.uf || ''} ${p.equipe ? `• Equipe: ${p.equipe}` : ''}`.trim(),
                target: (role === 'promotor' ? 'portal-promotor' : 'promotores') as ScreenId
              }));
            })()
          : Promise.resolve([]);

        // 2. Lojas / PDVs
        const lojasPromise = !isClientIndustry
          ? (async () => {
              const { data } = await supabase
                .from('lojas')
                .select('id, codigo, nome, cidade, uf, rede')
                .or(`nome.ilike.${pattern},codigo.ilike.${pattern},cidade.ilike.${pattern},rede.ilike.${pattern}`)
                .limit(5);

              return (data || []).map((l: any) => ({
                id: l.id || l.codigo,
                title: l.nome || l.codigo,
                subtitle: `Código: ${l.codigo} • ${l.cidade || ''}/${l.uf || ''} ${l.rede ? `• Rede: ${l.rede}` : ''}`.trim(),
                target: 'lojas' as ScreenId
              }));
            })()
          : Promise.resolve([]);

        // 3. Indústrias
        const industriasPromise = (async () => {
          let q = supabase
            .from('industrias')
            .select('id, codigo, nome')
            .or(`nome.ilike.${pattern},codigo.ilike.${pattern}`)
            .limit(5);

          if (isClientIndustry && profile?.industria_codigo) {
            q = q.eq('codigo', profile.industria_codigo);
          }

          const { data } = await q;
          return (data || []).map((ind: any) => ({
            id: ind.id || ind.codigo,
            title: ind.nome || ind.codigo,
            subtitle: `Código: ${ind.codigo}`,
            target: (isClientIndustry ? 'portal-industria' : 'industrias') as ScreenId
          }));
        })();

        // 4. Equipes
        const equipesPromise = canViewOps
          ? (async () => {
              const { data } = await supabase
                .from('equipes')
                .select('id, codigo, nome, regional, supervisor_nome')
                .or(`nome.ilike.${pattern},codigo.ilike.${pattern},regional.ilike.${pattern}`)
                .limit(5);

              return (data || []).map((eq: any) => ({
                id: eq.id || eq.codigo,
                title: eq.nome,
                subtitle: `Código: ${eq.codigo} • Regional: ${eq.regional || 'N/A'} ${eq.supervisor_nome ? `• Sup: ${eq.supervisor_nome}` : ''}`.trim(),
                target: 'gestao-equipes' as ScreenId
              }));
            })()
          : Promise.resolve([]);

        // 5. Rotas
        const rotasPromise = canViewOps
          ? (async () => {
              const { data } = await supabase
                .from('rotas')
                .select('*')
                .or(`codigo_rota.ilike.${pattern},promotor_matricula.ilike.${pattern},loja_codigo.ilike.${pattern},industria_codigo.ilike.${pattern}`)
                .limit(10);

              return (data || [])
                .filter((r: any) => !r.encerrada_em)
                .slice(0, 5)
                .map((r: any) => ({
                  id: r.id || r.codigo_rota,
                  title: `Rota ${r.codigo_rota || r.id.slice(0, 8)}`,
                  subtitle: `Promotor: ${r.promotor_matricula} • Loja: ${r.loja_codigo} • ${r.frequencia || 'SEMANAL'}`.trim(),
                  target: 'rotas-fixas' as ScreenId
                }));
            })()
          : Promise.resolve([]);

        const [promotores, lojas, industrias, equipes, rotas] = await Promise.all([
          promotoresPromise,
          lojasPromise,
          industriasPromise,
          equipesPromise,
          rotasPromise
        ]);

        if (seq === searchSeqRef.current) {
          setSearchResults({ promotores, lojas, industrias, equipes, rotas });
          setSearchLoading(false);
        }
      } catch (err: any) {
        if (seq === searchSeqRef.current) {
          console.error('Erro na pesquisa global:', err);
          setSearchError('Falha ao consultar dados.');
          setSearchLoading(false);
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [globalSearch, hasPermission, profile?.industria_codigo, role]);

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

  // Estado de Colapso da Sidebar (Desktop: 260px expandido vs 72px recolhido)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mk9_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('mk9_sidebar_collapsed', String(next));
      } catch {
        // Ignora erro de localStorage
      }
      return next;
    });
  };

  const navItems = [
    {
      group: role === 'promotor' ? 'Meu RH' : role === 'admin' ? 'Gestão RH' : 'Equipe RH',
      items: [{ id: 'rh-ausencias' as ScreenId, label: role === 'promotor' ? 'Minhas Ausências' : 'Faltas e Atestados', icon: 'event_busy', roles: ['admin', 'gestor', 'promotor'] as UserRole[] }]
    },
    {
      group: 'Visão Geral',
      items: [
        { id: 'cockpit' as ScreenId, label: 'Cockpit', icon: 'speed', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'painel-operacional' as ScreenId, label: 'Painel Operacional', icon: 'monitoring', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'Operação & Visitas',
      items: [
        { id: 'acompanhamento-visitas' as ScreenId, label: 'Acompanhamento', icon: 'travel_explore', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'presenca' as ScreenId, label: 'Controle de Presença', icon: 'how_to_reg', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'Roteiros & Frequências',
      items: [
        { id: 'rotas-fixas' as ScreenId, label: 'Rotas Fixas', icon: 'alt_route', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'Redes & Parceiros',
      items: [
        { id: 'lojas' as ScreenId, label: 'Lojas / PDVs', icon: 'store', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'industrias' as ScreenId, label: 'Indústrias & Contratos', icon: 'factory', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'Pessoas & Equipes',
      items: [
        { id: 'promotores' as ScreenId, label: 'Promotores CLT', icon: 'badge', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'freelancers' as ScreenId, label: 'Freelancers', icon: 'engineering', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'gestao-equipes' as ScreenId, label: 'Gestão de Equipes', icon: 'groups', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'supervisores' as ScreenId, label: 'Supervisores', icon: 'supervisor_account', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'Financeiro & Auditoria',
      items: [
        { id: 'controle-diarias' as ScreenId, label: 'Controle de Diárias', icon: 'payments', roles: ['admin', 'gestor', 'operador'] as UserRole[] }
      ]
    },
    {
      group: 'Portais Dedicados',
      items: [
        { id: 'portal-promotor' as ScreenId, label: 'Portal do Promotor', icon: 'smartphone', roles: ['admin', 'gestor', 'operador', 'promotor'] as UserRole[] },
        { id: 'portal-industria' as ScreenId, label: 'Portal da Indústria', icon: 'domain', roles: ['admin', 'gestor', 'client_industry'] as UserRole[] }
      ]
    },
    {
      group: 'Configurações & Acessos',
      items: [
        { id: 'usuarios' as ScreenId, label: 'Perfis & Permissões', icon: 'admin_panel_settings', roles: ['admin'] as UserRole[] },
        { id: 'importacao' as ScreenId, label: 'Importação de Dados', icon: 'upload_file', roles: ['admin', 'gestor'] as UserRole[] },
        { id: 'design-system' as ScreenId, label: 'Design System', icon: 'palette', roles: ['admin', 'gestor', 'operador'] as UserRole[] },
        { id: 'meu-perfil' as ScreenId, label: 'Meu Perfil', icon: 'account_circle', roles: ['admin', 'gestor', 'operador', 'promotor', 'client_industry'] as UserRole[] }
      ]
    }
  ];

  // Helper para Breadcrumbs
  const getBreadcrumbs = (): { group: string; label: string } => {
    for (const sec of navItems) {
      for (const it of sec.items) {
        if (it.id === currentScreen) {
          return { group: sec.group, label: it.label };
        }
      }
    }
    return { group: 'Sistema', label: 'Início' };
  };

  const breadcrumbs = getBreadcrumbs();

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

      {/* SIDEBAR NAVIGATION - Modo Expandido (260px) vs Modo Compacto (72px) */}
      <aside
        className={`fixed left-0 top-0 h-screen bg-[#F7F6F2] border-r border-[#CFCDC5] z-50 flex flex-col justify-between overflow-x-hidden overflow-y-auto transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[260px]'
        } ${mobileMenuOpen ? 'w-[260px] translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="flex flex-col">
          {/* Brand Header */}
          <div className="h-16 px-4 flex items-center justify-between border-b border-[#CFCDC5] bg-[#F7F6F2] select-none">
            <div
              onClick={() => onNavigate(role === 'promotor' ? 'portal-promotor' : 'cockpit')}
              className="flex items-center gap-2 cursor-pointer group"
              title="MK9 Date Trade Operations"
            >
              <span className="text-xl font-extrabold tracking-tight text-[#171717] font-sans">
                MK9
              </span>
              {(!sidebarCollapsed || mobileMenuOpen) && (
                <span className="text-xs font-bold text-[#286FF5] tracking-widest font-mono uppercase bg-[#EBF2FE] px-1.5 py-0.5 rounded border border-[#C3D9FD] animate-fadeIn">
                  DATE
                </span>
              )}
            </div>

            {/* Botão de Colapso Desktop */}
            <button
              onClick={toggleSidebarCollapse}
              className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#E4E2DB] transition-colors cursor-pointer"
              title={sidebarCollapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
              aria-label={sidebarCollapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            >
              <span className="material-symbols-outlined text-[18px]">
                {sidebarCollapsed ? 'chevron_right' : 'chevron_left'}
              </span>
            </button>
          </div>

          {/* Navigation Links */}
          <div className="py-4 px-2.5 space-y-4">
            {navItems.map((section) => {
              const visibleItems = section.items.filter((item) => item.id === 'rh-ausencias' ? (rh.mine || rh.team || rh.management) : !item.roles || hasPermission(item.roles));
              if (visibleItems.length === 0) return null;

              return (
                <div key={section.group} className="space-y-1">
                  {/* Título do Grupo (visível somente quando expandido) */}
                  {(!sidebarCollapsed || mobileMenuOpen) ? (
                    <div className="px-2.5 pb-1 text-[10px] font-bold text-[#737373] tracking-wider uppercase font-mono truncate">
                      {section.group}
                    </div>
                  ) : (
                    <div className="mx-auto w-6 border-b border-[#CFCDC5]/50 my-1.5" />
                  )}

                  <nav className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const isActive = currentScreen === item.id;
                      const isCompact = sidebarCollapsed && !mobileMenuOpen;

                      return (
                        <div key={item.id} className="relative group/nav">
                          <button
                            onClick={() => {
                              onNavigate(item.id);
                              setMobileMenuOpen(false);
                            }}
                            className={`w-full flex items-center ${
                              isCompact ? 'justify-center px-0 py-2.5' : 'justify-between px-3 py-2'
                            } rounded-lg text-xs font-medium transition-all cursor-pointer text-left ${
                              isActive
                                ? 'bg-[#111114] text-white font-semibold shadow-xs'
                                : 'text-[#525252] hover:text-[#171717] hover:bg-[#E4E2DB]'
                            }`}
                          >
                            <div className={`flex items-center ${isCompact ? 'justify-center' : 'gap-2.5'}`}>
                              <span
                                className={`material-symbols-outlined text-[20px] shrink-0 ${
                                  isActive ? 'text-white' : 'text-[#737373]'
                                }`}
                              >
                                {item.icon}
                              </span>
                              {(!sidebarCollapsed || mobileMenuOpen) && (
                                <span className="truncate">{item.label}</span>
                              )}
                            </div>

                            {(!sidebarCollapsed || mobileMenuOpen) && isActive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#286FF5] shrink-0" />
                            )}
                          </button>

                          {/* Tooltip flutuante no modo compacto */}
                          {isCompact && (
                            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2.5 py-1.5 bg-[#111114] text-white text-xs rounded-lg shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover/nav:opacity-100 group-hover/nav:pointer-events-auto transition-opacity duration-150 z-50 flex items-center gap-1.5 border border-[#CFCDC5]/30">
                              <span>{item.label}</span>
                              <span className="text-[10px] text-[#737373] font-mono">({section.group})</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </nav>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 m-2 rounded-lg bg-[#E4E2DB] border border-[#CFCDC5] space-y-2">
          {(!sidebarCollapsed || mobileMenuOpen) ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-[#16845B]" />
                  <span className="font-mono text-[11px] text-[#737373] font-medium">v2.6.0 GridCraft</span>
                </div>
                <button
                  onClick={toggleSidebarCollapse}
                  className="hidden lg:block text-[#737373] hover:text-[#171717] text-xs"
                  title="Recolher barra lateral"
                >
                  <span className="material-symbols-outlined text-[16px]">menu_open</span>
                </button>
              </div>
              <div className="pt-2 border-t border-[#CFCDC5]/60 flex justify-center">
                <AuthorSignature variant="compact" />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-[#16845B]" title="Operação Ativa" />
              <button
                onClick={toggleSidebarCollapse}
                className="text-[#737373] hover:text-[#171717] transition-colors p-1"
                title="Expandir barra lateral"
              >
                <span className="material-symbols-outlined text-[18px]">vertical_split</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* TOP HEADER - ArtCraft Clean Technical Toolbar com Breadcrumbs e Largura Adaptativa */}
      <header
        className={`fixed top-0 right-0 h-16 bg-[#F7F6F2] border-b border-[#CFCDC5] z-40 px-4 lg:px-6 flex items-center justify-between transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? 'lg:left-[72px]' : 'lg:left-[260px]'
        } left-0`}
      >
        {/* Left: Mobile hamburger, Breadcrumbs & Global Search */}
        <div className="flex items-center gap-4 flex-1 max-w-2xl">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#E4E2DB] cursor-pointer"
            aria-label="Abrir Menu"
          >
            <span className="material-symbols-outlined text-[22px]">menu</span>
          </button>

          {/* Breadcrumbs Contextuais */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium font-sans">
            <span className="text-[#737373] hover:text-[#171717] transition-colors">
              {breadcrumbs.group}
            </span>
            <span className="text-[#CFCDC5] font-mono">/</span>
            <span className="font-bold text-[#171717] bg-[#EAE8E2] px-2 py-0.5 rounded-md border border-[#CFCDC5]/70">
              {breadcrumbs.label}
            </span>
          </div>

          <div ref={searchContainerRef} className="relative w-full max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#737373] text-[18px]">
              {searchLoading ? 'sync' : 'search'}
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={globalSearch}
              onChange={(e) => {
                setGlobalSearch(e.target.value);
                setSearchFocused(true);
              }}
              onFocus={() => setSearchFocused(true)}
              placeholder="Buscar promotores, lojas, indústrias, equipes ou rotas..."
              className={`w-full h-9 pl-9 pr-14 bg-[#EAE8E2] border rounded-lg text-xs text-[#171717] placeholder:text-[#737373] transition-all font-sans ${
                searchFocused
                  ? 'border-[#111114] bg-white ring-1 ring-[#111114]'
                  : 'border-[#CFCDC5] focus:outline-none'
              }`}
            />
            {globalSearch ? (
              <button
                onClick={() => {
                  setGlobalSearch('');
                  setSearchResults({ promotores: [], lojas: [], industrias: [], equipes: [], rotas: [] });
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#171717] text-xs p-0.5 rounded cursor-pointer"
                title="Limpar pesquisa"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            ) : (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:flex items-center px-1.5 py-0.5 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-[10px] text-[#737373] font-mono pointer-events-none">
                Ctrl+K
              </div>
            )}

            {/* Dropdown de Resultados da Pesquisa Global */}
            {searchFocused && globalSearch.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl shadow-2xl overflow-hidden z-50 max-h-[75vh] flex flex-col animate-in fade-in slide-in-from-top-1 duration-150">
                {/* Header de Status */}
                <div className="px-3.5 py-2 bg-[#EAE8E2] border-b border-[#CFCDC5] flex items-center justify-between text-[11px] text-[#737373]">
                  <span>
                    Pesquisa para &quot;<strong className="text-[#171717]">{globalSearch.trim()}</strong>&quot;
                  </span>
                  {searchLoading && (
                    <span className="inline-flex items-center gap-1 font-mono text-purple-700">
                      <span className="material-symbols-outlined text-xs animate-spin">sync</span>
                      Buscando...
                    </span>
                  )}
                  {searchError && <span className="text-red-600 font-mono">{searchError}</span>}
                </div>

                <div className="overflow-y-auto divide-y divide-[#CFCDC5] text-xs">
                  {/* Sem Resultados */}
                  {!searchLoading &&
                    !searchError &&
                    searchResults.promotores.length === 0 &&
                    searchResults.lojas.length === 0 &&
                    searchResults.industrias.length === 0 &&
                    searchResults.equipes.length === 0 &&
                    searchResults.rotas.length === 0 && (
                      <div className="p-6 text-center text-[#737373] space-y-1">
                        <span className="material-symbols-outlined text-2xl text-[#A09E96]">search_off</span>
                        <p className="font-semibold text-xs text-[#171717]">Nenhum registro encontrado</p>
                        <p className="text-[11px]">Verifique a digitação ou tente outro termo de busca.</p>
                      </div>
                    )}

                  {/* 1. Promotores */}
                  {searchResults.promotores.length > 0 && (
                    <div className="p-2 space-y-1">
                      <div className="px-2 py-1 text-[10px] font-bold text-[#737373] uppercase font-mono flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-purple-600">badge</span>
                        Promotores ({searchResults.promotores.length})
                      </div>
                      {searchResults.promotores.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            onNavigate(item.target);
                            setSearchFocused(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#EAE8E2] transition-colors flex items-center justify-between group cursor-pointer"
                        >
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-[#171717] block truncate group-hover:text-purple-700">
                              {item.title}
                            </span>
                            <span className="text-[11px] text-[#737373] block truncate font-mono">
                              {item.subtitle}
                            </span>
                          </div>
                          <span className="material-symbols-outlined text-[16px] text-[#A09E96] group-hover:text-[#171717] shrink-0">
                            arrow_forward
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 2. Lojas / PDVs */}
                  {searchResults.lojas.length > 0 && (
                    <div className="p-2 space-y-1">
                      <div className="px-2 py-1 text-[10px] font-bold text-[#737373] uppercase font-mono flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-cyan-600">store</span>
                        Lojas / PDVs ({searchResults.lojas.length})
                      </div>
                      {searchResults.lojas.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            onNavigate(item.target);
                            setSearchFocused(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#EAE8E2] transition-colors flex items-center justify-between group cursor-pointer"
                        >
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-[#171717] block truncate group-hover:text-cyan-700">
                              {item.title}
                            </span>
                            <span className="text-[11px] text-[#737373] block truncate font-mono">
                              {item.subtitle}
                            </span>
                          </div>
                          <span className="material-symbols-outlined text-[16px] text-[#A09E96] group-hover:text-[#171717] shrink-0">
                            arrow_forward
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 3. Indústrias */}
                  {searchResults.industrias.length > 0 && (
                    <div className="p-2 space-y-1">
                      <div className="px-2 py-1 text-[10px] font-bold text-[#737373] uppercase font-mono flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-amber-600">factory</span>
                        Indústrias ({searchResults.industrias.length})
                      </div>
                      {searchResults.industrias.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            onNavigate(item.target);
                            setSearchFocused(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#EAE8E2] transition-colors flex items-center justify-between group cursor-pointer"
                        >
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-[#171717] block truncate group-hover:text-amber-700">
                              {item.title}
                            </span>
                            <span className="text-[11px] text-[#737373] block truncate font-mono">
                              {item.subtitle}
                            </span>
                          </div>
                          <span className="material-symbols-outlined text-[16px] text-[#A09E96] group-hover:text-[#171717] shrink-0">
                            arrow_forward
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 4. Equipes */}
                  {searchResults.equipes.length > 0 && (
                    <div className="p-2 space-y-1">
                      <div className="px-2 py-1 text-[10px] font-bold text-[#737373] uppercase font-mono flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-blue-600">groups</span>
                        Equipes ({searchResults.equipes.length})
                      </div>
                      {searchResults.equipes.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            onNavigate(item.target);
                            setSearchFocused(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#EAE8E2] transition-colors flex items-center justify-between group cursor-pointer"
                        >
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-[#171717] block truncate group-hover:text-blue-700">
                              {item.title}
                            </span>
                            <span className="text-[11px] text-[#737373] block truncate font-mono">
                              {item.subtitle}
                            </span>
                          </div>
                          <span className="material-symbols-outlined text-[16px] text-[#A09E96] group-hover:text-[#171717] shrink-0">
                            arrow_forward
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 5. Rotas */}
                  {searchResults.rotas.length > 0 && (
                    <div className="p-2 space-y-1">
                      <div className="px-2 py-1 text-[10px] font-bold text-[#737373] uppercase font-mono flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-emerald-600">alt_route</span>
                        Rotas ({searchResults.rotas.length})
                      </div>
                      {searchResults.rotas.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            onNavigate(item.target);
                            setSearchFocused(false);
                            setGlobalSearch('');
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#EAE8E2] transition-colors flex items-center justify-between group cursor-pointer"
                        >
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-[#171717] block truncate group-hover:text-emerald-700">
                              {item.title}
                            </span>
                            <span className="text-[11px] text-[#737373] block truncate font-mono">
                              {item.subtitle}
                            </span>
                          </div>
                          <span className="material-symbols-outlined text-[16px] text-[#A09E96] group-hover:text-[#171717] shrink-0">
                            arrow_forward
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer do Dropdown com Atalhos */}
                <div className="p-2 bg-[#EAE8E2] border-t border-[#CFCDC5] flex items-center justify-between text-[10px] text-[#737373] font-mono">
                  <span>Pressione ESC para fechar</span>
                  <span>Clique no item para navegar</span>
                </div>
              </div>
            )}
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
            <button
              onClick={() => onNavigate('meu-perfil')}
              title="Meu Perfil"
              className="flex items-center gap-2.5 text-left p-1 rounded-lg hover:bg-[#E4E2DB] transition-colors cursor-pointer group border border-transparent hover:border-[#CFCDC5]"
            >
              <div className="flex flex-col text-right hidden sm:flex">
                <span className="text-xs font-bold text-[#171717] leading-tight group-hover:text-[#286FF5] transition-colors">
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
              <div className="w-9 h-9 rounded-full bg-[#111114] text-white flex items-center justify-center shrink-0 border border-[#CFCDC5] group-hover:ring-2 group-hover:ring-[#286FF5] transition-all overflow-hidden">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Fallback silencioso para iniciais caso URL expire ou falhe
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span className="font-bold text-xs uppercase font-mono">
                    {(() => {
                      const n = profile?.promotor_nome || profile?.name || session?.user?.email || 'MK';
                      const parts = n.trim().split(/\s+/);
                      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                      return n.substring(0, 2).toUpperCase();
                    })()}
                  </span>
                )}
              </div>
            </button>

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

      {/* MAIN VIEWPORT - Margem esquerda adaptativa sincronizada com a largura da barra lateral */}
      <main
        className={`pt-16 flex-1 flex flex-col w-full min-h-[calc(100vh-4rem)] bg-[#EAE8E2] transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[260px]'
        } pl-0`}
      >
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
      <PWAInstallPrompt currentScreen={currentScreen} />
    </div>
  );
};
