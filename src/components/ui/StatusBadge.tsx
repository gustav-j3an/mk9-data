import React from 'react';

export type StatusBadgeVariant =
  | 'ativo'
  | 'inativo'
  | 'conforme'
  | 'pendente'
  | 'em_andamento'
  | 'concluida'
  | 'falta'
  | 'ruptura'
  | 'a_pagar'
  | 'pago'
  | 'semanal'
  | 'quinzenal'
  | 'mensal'
  | 'neutro'
  | 'default';

export interface StatusBadgeProps {
  status: string;
  variant?: StatusBadgeVariant;
  label?: string;
  className?: string;
  dot?: boolean;
}

interface BadgeStyle {
  bg: string;
  border: string;
  text: string;
  dotColor: string;
  defaultLabel: string;
}

const BADGE_MAP: Record<string, BadgeStyle> = {
  ativo: {
    bg: 'bg-[#E8F5EE]',
    border: 'border-[#B9E5D0]',
    text: 'text-[#16845B]',
    dotColor: 'bg-[#16845B]',
    defaultLabel: 'ATIVO'
  },
  conforme: {
    bg: 'bg-[#E8F5EE]',
    border: 'border-[#B9E5D0]',
    text: 'text-[#16845B]',
    dotColor: 'bg-[#16845B]',
    defaultLabel: 'CONFORME'
  },
  concluida: {
    bg: 'bg-[#E8F5EE]',
    border: 'border-[#B9E5D0]',
    text: 'text-[#16845B]',
    dotColor: 'bg-[#16845B]',
    defaultLabel: 'CONCLUÍDA'
  },
  pago: {
    bg: 'bg-[#E8F5EE]',
    border: 'border-[#B9E5D0]',
    text: 'text-[#16845B]',
    dotColor: 'bg-[#16845B]',
    defaultLabel: 'PAGO'
  },
  pendente: {
    bg: 'bg-[#FFF8E6]',
    border: 'border-[#FCE19B]',
    text: 'text-[#D98A00]',
    dotColor: 'bg-[#D98A00]',
    defaultLabel: 'PENDENTE'
  },
  em_andamento: {
    bg: 'bg-[#FFF8E6]',
    border: 'border-[#FCE19B]',
    text: 'text-[#D98A00]',
    dotColor: 'bg-[#D98A00]',
    defaultLabel: 'EM ANDAMENTO'
  },
  a_pagar: {
    bg: 'bg-[#FFF8E6]',
    border: 'border-[#FCE19B]',
    text: 'text-[#D98A00]',
    dotColor: 'bg-[#D98A00]',
    defaultLabel: 'A PAGAR'
  },
  inativo: {
    bg: 'bg-[#FDF2F2]',
    border: 'border-[#F8C8C8]',
    text: 'text-[#D93636]',
    dotColor: 'bg-[#D93636]',
    defaultLabel: 'INATIVO'
  },
  falta: {
    bg: 'bg-[#FDF2F2]',
    border: 'border-[#F8C8C8]',
    text: 'text-[#D93636]',
    dotColor: 'bg-[#D93636]',
    defaultLabel: 'FALTA'
  },
  ruptura: {
    bg: 'bg-[#FDF2F2]',
    border: 'border-[#F8C8C8]',
    text: 'text-[#D93636]',
    dotColor: 'bg-[#D93636]',
    defaultLabel: 'RUPTURA'
  },
  cancelado: {
    bg: 'bg-[#FDF2F2]',
    border: 'border-[#F8C8C8]',
    text: 'text-[#D93636]',
    dotColor: 'bg-[#D93636]',
    defaultLabel: 'CANCELADO'
  },
  semanal: {
    bg: 'bg-[#EBF2FE]',
    border: 'border-[#C3D9FD]',
    text: 'text-[#286FF5]',
    dotColor: 'bg-[#286FF5]',
    defaultLabel: 'SEMANAL'
  },
  quinzenal: {
    bg: 'bg-[#F3E8FF]',
    border: 'border-[#E9D5FF]',
    text: 'text-[#7E22CE]',
    dotColor: 'bg-[#7E22CE]',
    defaultLabel: 'QUINZENAL'
  },
  mensal: {
    bg: 'bg-[#FEF3C7]',
    border: 'border-[#FDE68A]',
    text: 'text-[#B45309]',
    dotColor: 'bg-[#B45309]',
    defaultLabel: 'MENSAL'
  },
  neutro: {
    bg: 'bg-[#E4E2DB]',
    border: 'border-[#CFCDC5]',
    text: 'text-[#525252]',
    dotColor: 'bg-[#737373]',
    defaultLabel: 'INDEFINIDO'
  }
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  variant,
  label,
  className = '',
  dot = true
}) => {
  const normalizedKey = (variant || status || 'neutro').toLowerCase().trim();
  const config = BADGE_MAP[normalizedKey] || BADGE_MAP.neutro;
  const displayLabel = label || (status ? status.toUpperCase() : config.defaultLabel);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border tracking-wider transition-colors ${config.bg} ${config.border} ${config.text} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dotColor}`} />}
      <span className="truncate">{displayLabel}</span>
    </span>
  );
};

