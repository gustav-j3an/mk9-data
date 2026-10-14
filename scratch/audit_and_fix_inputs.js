import fs from 'fs';
import path from 'path';

const srcDir = 'c:/projetos/mk9-data/src';

// We want to inspect all .tsx and .ts files for:
// 1. Text color on inputs/selects: `text-slate-200`, `text-slate-300`, `text-white` when background is light (`bg-[#EAE8E2]`, `bg-[#F7F6F2]`, `bg-[#E4E2DB]`, `bg-white`)
// 2. Headings/text that are `text-white` or `text-slate-100` on light containers
// 3. Buttons that still have purple/violet background or text (`bg-purple-600`, `from-purple-600`) where neutral black/gray is expected.

function scanDir(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      scanDir(full);
    } else if (f.name.endsWith('.tsx') || f.name.endsWith('.ts')) {
      const content = fs.readFileSync(full, 'utf8');
      
      // Let's do surgical fixes per file
      let modified = content;

      // Fix placeholder opacities and colors
      modified = modified.replace(/placeholder:text-slate-[456]00/g, 'placeholder:text-[#77766F]');
      modified = modified.replace(/placeholder:text-gray-[456]00/g, 'placeholder:text-[#77766F]');
      
      // Fix input/selects text color
      // e.g. `bg-[#EAE8E2] ... text-slate-200` -> `bg-[#EAE8E2] ... text-[#171717]`
      modified = modified.replace(/className="([^"]*?bg-\[#(?:EAE8E2|F7F6F2|E4E2DB)\][^"]*?)text-(?:slate-[123]00|white)([^"]*?)"/g, (match, p1, p2) => {
        return `className="${p1}text-[#171717]${p2}"`;
      });

      // Also selects or inputs with bg-transparent inside light wrappers
      // where text is text-slate-200 or text-white
      modified = modified.replace(/className="([^"]*?bg-transparent[^"]*?)text-(?:slate-[123]00|white)([^"]*?)"/g, (match, p1, p2) => {
        // if it's on a button with text-white on dark bg, don't change
        if (match.includes('bg-') && !match.includes('bg-transparent')) return match;
        return `className="${p1}text-[#171717]${p2}"`;
      });

      if (modified !== content) {
        fs.writeFileSync(full, modified, 'utf8');
        console.log(`Updated contrast tokens in: ${f.name}`);
      }
    }
  }
}

scanDir(srcDir);
console.log('Automated token scan complete.');
