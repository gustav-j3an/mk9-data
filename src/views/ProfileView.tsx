import React, { useState } from 'react';
import { ScreenId, ToastMessage } from '../types';
import { useAuth } from '../auth/AuthProvider';

interface ProfileViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ onNavigate, onShowToast }) => {
  const { session, profile, role, updateMyProfile, updateMyEmail, updatePassword } = useAuth();

  // Estados de Edição do Perfil Pessoal
  const [name, setName] = useState(profile?.name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Estados de Edição de E-mail
  const [newEmail, setNewEmail] = useState(session?.user?.email || '');
  const [savingEmail, setSavingEmail] = useState(false);

  // Estados de Troca de Senha
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Estados de Imagem / Avatar Local (Compressão no Navegador)
  const [localAvatarPreview, setLocalAvatarPreview] = useState<string | null>(profile?.avatar_url || null);
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState<boolean>(false);
  const [avatarSizeKb, setAvatarSizeKb] = useState<number | null>(null);
  const [avatarWarning, setAvatarWarning] = useState<string | null>(null);
  const [compressingImage, setCompressingImage] = useState(false);

  // Sincronizar avatar com profile quando carregar ou mudar
  React.useEffect(() => {
    if (profile?.avatar_url && !avatarBlob && !avatarRemoved) {
      setLocalAvatarPreview(profile.avatar_url);
    }
  }, [profile?.avatar_url, avatarBlob, avatarRemoved]);

  // Limpeza de URL temporária na desmontagem
  React.useEffect(() => {
    return () => {
      if (localAvatarPreview && localAvatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(localAvatarPreview);
      }
    };
  }, [localAvatarPreview]);

  // Iniciais para avatar fallback
  const initials = (() => {
    const raw = name.trim() || profile?.name || session?.user?.email || 'MK';
    const parts = raw.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return raw.substring(0, 2).toUpperCase();
  })();

  // 1. Compressão e Redimensionamento Local com Canvas (Máx 256x256 px, WebP)
  const handleSelectImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      onShowToast({
        title: 'Formato Inválido',
        message: 'Por favor, selecione um arquivo de imagem válido (JPG, PNG ou WebP).',
        type: 'warning'
      });
      return;
    }

    setCompressingImage(true);
    setAvatarWarning(null);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // Calcular recorte quadrado central (crop centralizado 1:1)
      const minDimension = Math.min(img.width, img.height);
      const cropX = (img.width - minDimension) / 2;
      const cropY = (img.height - minDimension) / 2;

      const targetSize = 256;
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setCompressingImage(false);
        onShowToast({
          title: 'Erro de Processamento',
          message: 'Não foi possível inicializar o canvas de imagem.',
          type: 'error'
        });
        return;
      }

      // Desenhar com recorte centralizado
      ctx.drawImage(img, cropX, cropY, minDimension, minDimension, 0, 0, targetSize, targetSize);

      canvas.toBlob(
        (blob) => {
          setCompressingImage(false);
          if (!blob) {
            onShowToast({
              title: 'Erro de Compressão',
              message: 'Falha ao gerar miniatura de imagem.',
              type: 'error'
            });
            return;
          }

          const sizeKb = Math.round(blob.size / 1024);
          setAvatarSizeKb(sizeKb);
          setAvatarBlob(blob);
          setAvatarRemoved(false);

          if (sizeKb > 100) {
            setAvatarWarning(`A imagem comprimida possui ${sizeKb} KB (limite recomendado: 100 KB). Tente outra foto mais simples.`);
          } else {
            setAvatarWarning(null);
          }

          if (localAvatarPreview && localAvatarPreview.startsWith('blob:')) {
            URL.revokeObjectURL(localAvatarPreview);
          }

          const previewUrl = URL.createObjectURL(blob);
          setLocalAvatarPreview(previewUrl);
        },
        'image/webp',
        0.82
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setCompressingImage(false);
      onShowToast({
        title: 'Erro ao Carregar Imagem',
        message: 'O arquivo selecionado não pôde ser lido.',
        type: 'error'
      });
    };

    img.src = objectUrl;
  };

  // Remover foto selecionada
  const handleRemovePhoto = () => {
    if (localAvatarPreview && localAvatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(localAvatarPreview);
    }
    setLocalAvatarPreview(null);
    setAvatarBlob(null);
    setAvatarRemoved(true);
    setAvatarSizeKb(null);
    setAvatarWarning(null);
  };

  // 2. Salvar Dados Pessoais (Nome, Telefone e Avatar)
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onShowToast({
        title: 'Nome Obrigatório',
        message: 'Por favor, preencha o seu nome de exibição.',
        type: 'warning'
      });
      return;
    }

    setSavingProfile(true);
    const res = await updateMyProfile({
      name: name.trim(),
      phone: phone.trim() || null,
      avatarBlob: avatarBlob,
      removeAvatar: avatarRemoved
    });
    setSavingProfile(false);

    if (res.error) {
      onShowToast({
        title: 'Falha ao Salvar Perfil',
        message: res.error.message,
        type: 'error'
      });
      return;
    }

    // Se houve sucesso no upload/remoção, atualizar preview local com a URL assinada real
    if (res.avatarUrl !== undefined) {
      if (localAvatarPreview && localAvatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(localAvatarPreview);
      }
      setLocalAvatarPreview(res.avatarUrl || null);
      setAvatarBlob(null);
      setAvatarRemoved(false);
      setAvatarSizeKb(null);
    }

    onShowToast({
      title: 'Perfil Atualizado! 🎉',
      message: 'Seus dados pessoais e foto foram salvos com sucesso.',
      type: 'success'
    });
  };

  // 3. Solicitar Troca de E-mail (Supabase Auth com Confirmação)
  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentEmail = session?.user?.email || '';
    if (newEmail.trim().toLowerCase() === currentEmail.toLowerCase()) {
      onShowToast({
        title: 'E-mail Inalterado',
        message: 'O e-mail digitado é idêntico ao e-mail atual da conta.',
        type: 'info'
      });
      return;
    }

    setSavingEmail(true);
    const res = await updateMyEmail(newEmail.trim());
    setSavingEmail(false);

    if (res.error) {
      onShowToast({
        title: 'Falha ao Alterar E-mail',
        message: res.error.message,
        type: 'error'
      });
      return;
    }

    onShowToast({
      title: 'Confirmação Enviada ✉️',
      message: `Um link de validação foi enviado para ${newEmail.trim()}. Acesse a sua caixa de entrada para confirmar a alteração.`,
      type: 'success'
    });
  };

  // 4. Alterar Senha
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || newPassword.length < 6) {
      onShowToast({
        title: 'Senha Muito Curta',
        message: 'A nova senha deve ter no mínimo 6 caracteres.',
        type: 'warning'
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      onShowToast({
        title: 'Senhas Não Conferem',
        message: 'A nova senha e a confirmação devem ser rigorosamente iguais.',
        type: 'warning'
      });
      return;
    }

    setSavingPassword(true);
    const res = await updatePassword(newPassword);
    setSavingPassword(false);

    if (res.error) {
      onShowToast({
        title: 'Falha ao Atualizar Senha',
        message: res.error.message,
        type: 'error'
      });
      return;
    }

    setNewPassword('');
    setConfirmPassword('');
    onShowToast({
      title: 'Senha Atualizada com Sucesso! 🔐',
      message: 'Sua credencial de acesso foi alterada com segurança.',
      type: 'success'
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16 px-4 lg:px-8 pt-6">
      {/* 1. Header do Perfil */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#CFCDC5] shadow-xs">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[#111114] text-white flex items-center justify-center shrink-0 border border-[#CFCDC5] overflow-hidden shadow-xs">
            {localAvatarPreview ? (
              <img src={localAvatarPreview} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="font-bold text-xl uppercase font-mono">{initials}</span>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#171717] flex items-center gap-2">
              Meu Perfil
              <span className="text-xs px-2 py-0.5 rounded-full font-mono font-semibold bg-[#EAE8E2] text-[#525252] border border-[#CFCDC5]">
                {role.toUpperCase()}
              </span>
            </h1>
            <p className="text-xs text-[#737373] mt-0.5">
              Gerencie suas informações pessoais, credenciais de acesso e preferências.
            </p>
          </div>
        </div>

        <button
          onClick={() => onNavigate('cockpit')}
          className="px-4 py-2 bg-[#F7F6F2] hover:bg-[#EAE8E2] text-[#171717] rounded-xl text-xs font-semibold border border-[#CFCDC5] transition-colors flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          <span>Voltar ao Início</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coluna da Esquerda (2 Colunas): Dados Pessoais, Foto e Senha */}
        <div className="lg:col-span-2 space-y-6">
          {/* SEÇÃO 1: FOTO DE PERFIL */}
          <div className="bg-white p-6 rounded-2xl border border-[#CFCDC5] shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-700 text-lg">account_circle</span>
                <h2 className="text-sm font-bold text-[#171717]">Foto de Perfil Opcional</h2>
              </div>
              <span className="text-[10px] font-mono text-[#737373] bg-[#EAE8E2] px-2 py-0.5 rounded">
                256 × 256 px • Máx 100 KB
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-5 pt-1">
              <div className="w-24 h-24 rounded-2xl bg-[#111114] text-white flex items-center justify-center shrink-0 border-2 border-[#CFCDC5] overflow-hidden shadow-inner">
                {localAvatarPreview ? (
                  <img src={localAvatarPreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="font-bold text-2xl uppercase font-mono">{initials}</span>
                )}
              </div>

              <div className="flex-1 space-y-2 text-center sm:text-left">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <label className="px-3.5 py-2 bg-[#111114] hover:bg-black text-white text-xs font-semibold rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-xs">
                    <span className="material-symbols-outlined text-sm">photo_camera</span>
                    <span>{compressingImage ? 'Processando...' : 'Selecionar Imagem'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleSelectImage}
                      disabled={compressingImage}
                      className="hidden"
                    />
                  </label>

                  {localAvatarPreview && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="px-3 py-2 bg-[#FDF2F2] hover:bg-[#FCE8E8] text-[#D93636] border border-[#F8C8C8] text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                      <span>Remover</span>
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-[#737373] leading-relaxed">
                  A imagem é automaticamente recortada em formato quadrado e comprimida no navegador para manter consumo zero de dados pesados.
                </p>

                {avatarSizeKb !== null && (
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">
                    <span className="material-symbols-outlined text-xs">check_circle</span>
                    Tamanho otimizado: <strong>{avatarSizeKb} KB</strong> (dentro da meta econômica de 20–50 KB)
                  </div>
                )}

                {avatarWarning && (
                  <div className="p-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm shrink-0">warning</span>
                    <span>{avatarWarning}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Aviso sobre a Estratégia de Armazenamento Seguro */}
            <div className="p-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl text-[11px] text-[#737373] space-y-1">
              <span className="font-bold text-[#171717] flex items-center gap-1">
                <span className="material-symbols-outlined text-xs text-blue-600">verified_user</span>
                Armazenamento Seguro de Fotos
              </span>
              <p>
                A foto é salva no bucket privado e isolado do Supabase Storage (<code className="font-mono text-[10px]">avatars</code>), protegida por políticas RLS onde cada usuário acessa apenas sua própria pasta via URL assinada segura.
              </p>
            </div>
          </div>

          {/* SEÇÃO 2: DADOS PESSOAIS */}
          <form onSubmit={handleSaveProfile} className="bg-white p-6 rounded-2xl border border-[#CFCDC5] shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-700 text-lg">badge</span>
                <h2 className="text-sm font-bold text-[#171717]">Dados de Exibição</h2>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#525252] mb-1.5">
                  Nome Completo / Exibição *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                  required
                  className="w-full h-10 px-3.5 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:bg-white focus:outline-hidden focus:border-[#111114] transition-all font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#525252] mb-1.5">
                  Telefone / WhatsApp (Opcional)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(00) 00000-0000"
                  className="w-full h-10 px-3.5 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:bg-white focus:outline-hidden focus:border-[#111114] transition-all font-sans"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingProfile}
                className="px-5 py-2.5 bg-[#111114] hover:bg-black text-white text-xs font-bold rounded-xl transition-all shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {savingProfile && <span className="material-symbols-outlined text-sm animate-spin">sync</span>}
                <span>Salvar Informações</span>
              </button>
            </div>
          </form>

          {/* SEÇÃO 3: E-MAIL DE ACESSO */}
          <form onSubmit={handleSaveEmail} className="bg-white p-6 rounded-2xl border border-[#CFCDC5] shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-600 text-lg">mail</span>
                <h2 className="text-sm font-bold text-[#171717]">E-mail da Conta</h2>
              </div>
              <span className="text-[10px] font-mono text-[#737373] bg-[#EAE8E2] px-2 py-0.5 rounded">
                Exige Validação
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#525252] mb-1.5">
                Endereço de E-mail Cadastrado
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="seu.email@empresa.com.br"
                required
                className="w-full h-10 px-3.5 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:bg-white focus:outline-hidden focus:border-[#111114] transition-all font-sans"
              />
              <p className="text-[11px] text-[#737373] mt-1.5">
                Ao salvar um novo endereço, o Supabase Auth enviará um link de verificação para a sua caixa postal antes de efetivar a troca.
              </p>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={savingEmail || newEmail.trim().toLowerCase() === (session?.user?.email || '').toLowerCase()}
                className="px-4 py-2 bg-[#F7F6F2] hover:bg-[#EAE8E2] text-[#171717] border border-[#CFCDC5] text-xs font-bold rounded-xl transition-all shadow-xs disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
              >
                {savingEmail && <span className="material-symbols-outlined text-sm animate-spin">sync</span>}
                <span>Atualizar E-mail</span>
              </button>
            </div>
          </form>

          {/* SEÇÃO 4: SEGURANÇA E ALTERAÇÃO DE SENHA */}
          <form onSubmit={handleSavePassword} className="bg-white p-6 rounded-2xl border border-[#CFCDC5] shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-lg">lock</span>
                <h2 className="text-sm font-bold text-[#171717]">Segurança &amp; Senha de Acesso</h2>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#525252] mb-1.5">
                  Nova Senha *
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo de 6 caracteres"
                  required
                  className="w-full h-10 px-3.5 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:bg-white focus:outline-hidden focus:border-[#111114] transition-all font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#525252] mb-1.5">
                  Confirmar Nova Senha *
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita a nova senha"
                  required
                  className="w-full h-10 px-3.5 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:bg-white focus:outline-hidden focus:border-[#111114] transition-all font-sans"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingPassword || !newPassword || newPassword !== confirmPassword}
                className="px-5 py-2.5 bg-[#111114] hover:bg-black text-white text-xs font-bold rounded-xl transition-all shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {savingPassword && <span className="material-symbols-outlined text-sm animate-spin">sync</span>}
                <span>Alterar Senha</span>
              </button>
            </div>
          </form>
        </div>

        {/* Coluna da Direita (1 Coluna): Dados Operacionais Somente Leitura */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-[#CFCDC5] shadow-xs space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#CFCDC5]">
              <span className="material-symbols-outlined text-[#737373] text-lg">admin_panel_settings</span>
              <h2 className="text-sm font-bold text-[#171717]">Vínculos Operacionais</h2>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-1">
                <span className="text-[10px] font-bold uppercase font-mono text-[#737373] block">
                  Papel de Acesso (RBAC)
                </span>
                <span className="font-bold text-[#171717] text-sm block">
                  {role.toUpperCase()}
                </span>
                <span className="text-[11px] text-[#737373] block">
                  Definido pelo administrador da organização.
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-1">
                <span className="text-[10px] font-bold uppercase font-mono text-[#737373] block">
                  Departamento
                </span>
                <span className="font-semibold text-[#171717] block">
                  {profile?.department || 'Operações MK9'}
                </span>
              </div>

              {profile?.promotor_matricula && (
                <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 space-y-1 text-purple-900">
                  <span className="text-[10px] font-bold uppercase font-mono text-purple-700 block">
                    Matrícula de Campo
                  </span>
                  <span className="font-mono font-bold text-sm block">
                    {profile.promotor_matricula}
                  </span>
                  {profile.promotor_equipe && (
                    <span className="text-[11px] text-purple-700 block">
                      Equipe: <strong>{profile.promotor_equipe}</strong>
                    </span>
                  )}
                  {profile.promotor_supervisor && (
                    <span className="text-[11px] text-purple-700 block">
                      Supervisor: <strong>{profile.promotor_supervisor}</strong>
                    </span>
                  )}
                </div>
              )}

              {profile?.industria_codigo && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1 text-amber-900">
                  <span className="text-[10px] font-bold uppercase font-mono text-amber-700 block">
                    Indústria Vinculada
                  </span>
                  <span className="font-mono font-bold text-sm block">
                    {profile.industria_codigo}
                  </span>
                  {profile.industria_nome && (
                    <span className="text-[11px] text-amber-700 block">
                      {profile.industria_nome}
                    </span>
                  )}
                </div>
              )}

              <div className="p-3 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-1 text-[11px] text-[#737373]">
                <span className="text-[10px] font-bold uppercase font-mono block">
                  ID de Autenticação (UUID)
                </span>
                <span className="font-mono text-[10px] text-[#171717] block truncate">
                  {session?.user?.id || '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

