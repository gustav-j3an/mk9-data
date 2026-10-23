import type { ToastMessage } from '../types';

export function getToastPresentation(type: ToastMessage['type']) {
  switch (type) {
    case 'error':
      return { icon: 'error', iconClass: 'bg-red-50 text-red-700 border-red-200' };
    case 'warning':
      return { icon: 'warning', iconClass: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'info':
      return { icon: 'info', iconClass: 'bg-cyan-50 text-cyan-700 border-cyan-200' };
    case 'success':
    default:
      return { icon: 'done', iconClass: 'bg-[#E8F5EE] text-[#16845B] border-[#B9E5D0]' };
  }
}
