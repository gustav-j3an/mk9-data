import fs from 'fs';
import path from 'path';

const srcDir = 'c:/projetos/mk9-data/src';

// Refinements according to User Directives:
// 1. Table thead should be #E3E1DA with text #171717 font-bold (higher contrast than #EAE8E2 with #77766F).
// 2. Table tbody rows: fine horizontal border divide-[#CFCDC5], hover bg-[#EAE8E1], dark text #171717.
// 3. Remove remaining inline white texts like `text-white` on table cells (e.g. lojaNome, promotorNome).
// 4. Badges: semantic colors with readable contrast.
//    - Ruptura / Crítico: bg-rose-100 text-rose-800 border-rose-300
//    - Atenção: bg-amber-100 text-amber-900 border-amber-300
//    - Pendente: bg-yellow-100 text-yellow-900 border-yellow-300
//    - Resolvido / Sucesso: bg-emerald-100 text-emerald-900 border-emerald-300
//    - Em andamento: bg-cyan-100 text-cyan-900 border-cyan-300
// 5. Industry names in tables: change `text-purple-300` to `#7E22CE` or `#222222` font-bold.
// 6. Section 1 / Section 2 titles in OperationalDashboardView: `text-white` -> `text-[#171717]`

function refineFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // 1. Table headers: bg-[#EAE8E2] border-b border-[#CFCDC5] text-[11px] font-bold text-[#77766F] -> bg-[#E3E1DA] text-[#171717]
  content = content.replace(/<tr className="bg-\[#EAE8E2\] border-b border-\[#CFCDC5\] text-\[11px\] font-bold text-\[#77766F\]/g,
    '<tr className="bg-[#E3E1DA] border-b border-[#CFCDC5] text-[11px] font-bold text-[#171717]');

  // 2. Headings inside sections in OperationalDashboardView
  content = content.replace(/<span className="text-xs font-bold text-white uppercase tracking-wider flex items-center/g,
    '<span className="text-xs font-bold text-[#171717] uppercase tracking-wider flex items-center');

  // 3. Industry colors that were text-purple-300 on light rows
  content = content.replace(/className="py-3 px-4 font-bold text-purple-300"/g, 'className="py-3 px-4 font-bold text-[#7E22CE]"');
  content = content.replace(/className="py-3.5 px-4 font-bold text-purple-300"/g, 'className="py-3.5 px-4 font-bold text-[#7E22CE]"');
  content = content.replace(/className="font-bold text-purple-300/g, 'className="font-bold text-[#7E22CE]');
  content = content.replace(/text-purple-300 font-bold/g, 'text-[#7E22CE] font-bold');

  // 4. White store name or promoter name in table rows
  content = content.replace(/<td className="py-3 px-4 font-bold text-white">/g, '<td className="py-3 px-4 font-bold text-[#171717]">');
  content = content.replace(/<td className="py-2.5 px-3 font-bold text-white/g, '<td className="py-2.5 px-3 font-bold text-[#171717]');
  content = content.replace(/<span className="text-white font-bold">/g, '<span className="text-[#171717] font-bold">');

  // 5. Badges in OperationalDashboard:
  // let prioBadge = { label: '🔴 CRÍTICO', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse' };
  content = content.replace(/prioBadge = \{ label: '🔴 CRÍTICO', color: '[^']+' \};/g,
    "prioBadge = { label: '🔴 CRÍTICO', color: 'bg-rose-50 text-rose-800 border-rose-300 font-bold' };");
  content = content.replace(/prioBadge = \{ label: '🟠 ATENÇÃO', color: '[^']+' \};/g,
    "prioBadge = { label: '🟠 ATENÇÃO', color: 'bg-amber-50 text-amber-900 border-amber-300 font-bold' };");
  content = content.replace(/prioBadge = \{ label: '🟡 PENDENTE', color: '[^']+' \};/g,
    "prioBadge = { label: '🟡 PENDENTE', color: 'bg-yellow-50 text-yellow-900 border-yellow-300 font-bold' };");
  content = content.replace(/prioBadge = \{ label: '🟢 RESOLVIDO', color: '[^']+' \};/g,
    "prioBadge = { label: '🟢 RESOLVIDO', color: 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold' };");

  // Agenda badges:
  content = content.replace(/badge = \{ label: '🟡 Pendente', color: '[^']+' \};/g,
    "badge = { label: '🟡 Pendente', color: 'bg-yellow-50 text-yellow-900 border-yellow-300 font-bold' };");
  content = content.replace(/badge = \{ label: '🔵 Em andamento', color: '[^']+' \};/g,
    "badge = { label: '🔵 Em andamento', color: 'bg-cyan-50 text-cyan-900 border-cyan-300 font-bold' };");
  content = content.replace(/badge = \{ label: '🔴 Não realizada', color: '[^']+' \};/g,
    "badge = { label: '🔴 Não realizada', color: 'bg-rose-50 text-rose-800 border-rose-300 font-bold' };");
  content = content.replace(/badge = \{ label: '🟢 Concluída', color: '[^']+' \};/g,
    "badge = { label: '🟢 Concluída', color: 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold' };");

  // Hover table row to #EAE8E1
  content = content.replace(/hover:bg-\[#EAE8E2\]\/70/g, 'hover:bg-[#EAE8E1]');
  content = content.replace(/hover:bg-\[#EAE8E2\]\/60/g, 'hover:bg-[#EAE8E1]');
  content = content.replace(/hover:bg-\[#EAE8E2\]\/80/g, 'hover:bg-[#EAE8E1]');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Refined table and badge styles in: ${path.basename(filePath)}`);
  }
}

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      walk(full);
    } else if (item.name.endsWith('.tsx')) {
      refineFile(full);
    }
  }
}

walk(srcDir);
console.log('Tables, badges, and headers refined across all views.');
