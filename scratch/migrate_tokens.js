import fs from 'fs';
import path from 'path';

const targetDirs = ['src/views', 'src/components', 'src/auth'];

const replacements = [
  // 1. Dark background colors -> ArtCraft / GridCraft palette
  [/#0f131d/gi, '#F3F2EE'],
  [/#0a0d14/gi, '#EAE9E4'],
  [/#171b26/gi, '#FAF9F6'],
  [/#131722/gi, '#F3F2EE'],
  [/#1f2433/gi, '#EAE9E4'],
  [/#10141f/gi, '#EAE9E4'],
  [/#111522/gi, '#FAF9F6'],
  [/#1c2230/gi, '#EAE9E4'],
  [/#282e40/gi, '#D0CFC9'],

  // 2. Borders
  [/#1e2433/gi, '#D0CFC9'],
  [/#2a3042/gi, '#D0CFC9'],
  [/border-slate-800/gi, 'border-[#D0CFC9]'],
  [/border-slate-700/gi, 'border-[#D0CFC9]'],

  // 3. Neon glows
  [/neon-purple-glow/gi, 'shadow-xs'],
  [/neon-purple-subtle/gi, 'shadow-xs'],
  [/neon-green-glow/gi, 'shadow-xs'],
  [/neon-cyan-glow/gi, 'shadow-xs'],
  [/neon-amber-glow/gi, 'shadow-xs'],
  [/neon-rose-glow/gi, 'shadow-xs'],
];

let totalChanges = 0;

for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue;
    const fullPath = path.join(dir, file);
    let content = fs.readFileSync(fullPath, 'utf8');
    let modified = false;

    for (const [pattern, rep] of replacements) {
      if (pattern.test(content)) {
        content = content.replace(pattern, rep);
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(fullPath, content, 'utf8');
      console.log(`Updated: ${fullPath}`);
      totalChanges++;
    }
  }
}

console.log(`Total files updated: ${totalChanges}`);
