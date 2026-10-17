import React from 'react';

interface AuthorSignatureProps {
  /**
   * Variante visual:
   * - 'muted': Estilo discreto e técnico para rodapés (padrão)
   * - 'compact': Versão reduzida para barras laterais estreitas ou espaços restritos
   * - 'badge': Versão em cápsula/badge com borda sutil
   */
  variant?: 'muted' | 'compact' | 'badge';
  className?: string;
}

export const AuthorSignature: React.FC<AuthorSignatureProps> = ({
  variant = 'muted',
  className = ''
}) => {
  if (variant === 'badge') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#EAE8E2] border border-[#CFCDC5] text-[11px] font-mono text-[#737373] select-none ${className}`}
        title="Plataforma MK9 Date"
      >
        <span className="material-symbols-outlined text-[13px] text-[#286FF5]">code</span>
        <span>
          Desenvolvido por <strong className="font-semibold text-[#171717]">Gustavo Jean</strong>
        </span>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div
        className={`text-[10px] font-mono text-[#737373] tracking-tight text-center select-none ${className}`}
        title="Plataforma MK9 Date"
      >
        Desenvolvido por <span className="font-semibold text-[#525252]">Gustavo Jean</span>
      </div>
    );
  }

  return (
    <div
      className={`text-xs font-mono text-[#737373] flex items-center justify-center gap-1.5 select-none ${className}`}
      title="Plataforma MK9 Date"
    >
      <span>Desenvolvido por</span>
      <strong className="font-semibold text-[#171717]">Gustavo Jean</strong>
    </div>
  );
};

