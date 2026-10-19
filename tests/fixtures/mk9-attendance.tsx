import React from 'react';
import { createRoot } from 'react-dom/client';
import { AttendanceControlView } from '../../src/views/AttendanceControlView';
import '../../src/index.css';

const noop = () => {};
const toast = (t: unknown) => console.log('Toast:', t);

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-[#EAE8E2] text-[#171717]">
    <AttendanceControlView onNavigate={noop} onShowToast={toast} />
  </div>
);

