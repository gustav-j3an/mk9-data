import React from 'react';

export type StatCardVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  icon?: string;
  variant?: StatCardVariant;
  className?: string;
  onClick?: () => void;
}

interface VariantStyle {
  border: string;
  iconBg: string;
  iconColor: string;
  valueColor: string;
}

const VARIANT_MAP: Record<StatCardVariant, VariantStyle> = {
  default: {
    border: 'border-[#CFCDC5]',
    iconBg: 'bg-[#EAE8E2]',
    iconColor: 'text-[#171717]',
    valueColor: 'text-[#171717]'
  },
  success: {
    border: 'border-[#16845B]/30',
    iconBg: 'bg-[#E8F5EE]',
    iconColor: 'text-[#16845B]',
    valueColor: 'text-[#16845B]'
  },
  warning: {
    border: 'border-[#D98A00]/30',
    iconBg: 'bg-[#FFF8E6]',
    iconColor: 'text-[#D98A00]',
    valueColor: 'text-[#D98A00]'
  },
  danger: {
    border: 'border-[#D93636]/30',
    iconBg: 'bg-[#FDF2F2]',
    iconColor: 'text-[#D93636]',
    valueColor: 'text-[#D93636]'
  },
  info: {
    border: 'border-[#286FF5]/30',
    iconBg: 'bg-[#EBF2FE]',
    iconColor: 'text-[#286FF5]',
    valueColor: 'text-[#286FF5]'
  }
};

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  description,
  subtitle,
  badge,
  icon,
  variant = 'default',
  className = '',
  onClick
}) => {
  const styles = VARIANT_MAP[variant] || VARIANT_MAP.default;
  const isClickable = Boolean(onClick);

  return (
    <div
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`p-4 sm:p-5 rounded-2xl bg-[#F7F6F2] border shadow-xs flex flex-col justify-between transition-all ${styles.border} ${
        isClickable
          ? 'cursor-pointer hover:shadow-md hover:border-purple-400 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-purple-500/30'
          : 'hover:shadow-md'
      } ${className}`}
    >
      <div className="flex items-center justify-between text-xs font-mono font-bold text-[#737373] uppercase tracking-wider gap-2">
        <span className="truncate">{title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {badge}
          {icon && (
            <span
              className={`material-symbols-outlined text-lg p-1.5 rounded-lg shrink-0 ${styles.iconBg} ${styles.iconColor}`}
            >
              {icon}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className={`text-2xl sm:text-3xl font-extrabold font-mono tracking-tight ${styles.valueColor}`}>
          {value}
        </div>
        {description && (
          <div className="mt-1 text-xs text-[#737373] font-sans truncate">
            {description}
          </div>
        )}
        {subtitle && (
          <div className="mt-2.5 pt-2 border-t border-[#CFCDC5]/60 text-[11px] text-[#5F5F5F] font-mono">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
};


