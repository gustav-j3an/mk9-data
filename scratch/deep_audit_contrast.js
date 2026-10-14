import fs from 'fs';
import path from 'path';

const srcDir = 'c:/projetos/mk9-data/src';

// Targets to fix:
// 1. `text-white` on elements that do NOT have a dark background or dark button container.
// Specifically:
// - `text-white` inside cards, badges, headings, metric numbers, drawer items, list items, labels.
// - `text-slate-100`, `text-slate-200`, `text-slate-300`, `text-slate-400` where contrast is low.
// - `label className="... text-slate-300"` -> `label className="... text-[#171717]"`
// - `<strong className="text-white">` on light panels -> `<strong className="text-[#171717]">`
// - `<span className="... text-white font-mono ...">` metric numbers -> `text-[#171717]`

function auditFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // 1. Labels with text-slate-300 or text-slate-400
  content = content.replace(/className="([^"]*?)text-slate-[34]00([^"]*?)"/g, (match, p1, p2) => {
    // If it's a label or heading or strong
    return `className="${p1}text-[#171717]${p2}"`;
  });

  // 2. Specific patterns of text-white on light backgrounds
  // e.g. <strong className="text-white">
  content = content.replace(/<strong className="text-white">/g, '<strong className="text-[#171717]">');
  content = content.replace(/<strong className="([^"]*?)text-white([^"]*?)">/g, (match, p1, p2) => {
    return `<strong className="${p1}text-[#171717]${p2}">`;
  });

  // 3. Metric numbers with text-white
  // e.g. font-extrabold text-white
  content = content.replace(/font-extrabold text-white/g, 'font-extrabold text-[#171717]');
  content = content.replace(/font-bold text-white font-mono/g, 'font-bold text-[#171717] font-mono');
  content = content.replace(/font-extrabold text-white font-mono/g, 'font-extrabold text-[#171717] font-mono');

  // 4. Modal / form labels: font-bold text-slate-300
  content = content.replace(/font-bold text-slate-300/g, 'font-bold text-[#171717]');

  // 5. Drawer tabs: text-white on inactive or light background
  content = content.replace(/drawerTab === 'dados' \? 'bg-\[#E4E2DB\] text-white/g, "drawerTab === 'dados' ? 'bg-[#222222] text-white");

  // 6. Supervisor block in TeamsManagementView & similar
  content = content.replace(/<span className="text-xs font-bold text-white flex items-center gap-1">/g, '<span className="text-xs font-bold text-[#171717] flex items-center gap-1">');
  content = content.replace(/<span className="text-xs font-bold text-white block truncate">/g, '<span className="text-xs font-bold text-[#171717] block truncate">');
  content = content.replace(/<span className="text-xs font-bold text-white flex items-center gap-2">/g, '<span className="text-xs font-bold text-[#171717] flex items-center gap-2">');

  // 7. Checkbox list items: text-slate-300 -> text-[#222222]
  content = content.replace(/'bg-\[#EAE8E2\] border-\[#CFCDC5\] text-slate-300 hover:bg-\[#1a202d\]'/g, "'bg-[#EAE8E2] border-[#CFCDC5] text-[#222222] hover:bg-[#E4E2DB]'");

  // 8. Filter buttons: text-slate-300 hover:text-white
  content = content.replace(/text-slate-300 hover:text-white/g, 'text-[#5F5F5F] hover:text-[#171717]');

  // 9. Buttons with light background and text-slate-300
  content = content.replace(/bg-\[#F7F6F2\] border border-\[#CFCDC5\] text-xs font-semibold text-slate-300/g, 'bg-[#F7F6F2] border border-[#CFCDC5] text-xs font-semibold text-[#171717]');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Refined light contrast in: ${path.basename(filePath)}`);
  }
}

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      walk(full);
    } else if (item.name.endsWith('.tsx')) {
      auditFile(full);
    }
  }
}

walk(srcDir);
console.log('System-wide light theme text contrast scan completed.');
