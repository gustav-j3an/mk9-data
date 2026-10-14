import fs from 'fs';
import path from 'path';

const targetDirs = ['src/views', 'src/components', 'src/auth'];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // 1. Títulos e cabeçalhos com text-white -> text-[#171717]
  content = content.replace(/(<(?:h1|h2|h3|h4|h5|h6)[^>]*?\btext-)white\b/gi, '$1[#171717]');

  // 2. Headings com text-slate-100 ou text-slate-200 -> text-[#171717]
  content = content.replace(/(<(?:h1|h2|h3|h4|h5|h6)[^>]*?\btext-slate-)[12]00\b/gi, '$1[#171717]');

  // 3. Indicadores numéricos text-3xl ou text-2xl com text-white -> text-[#171717]
  content = content.replace(/(\btext-[234]xl\s+[^"'>]*?\btext-)white\b/gi, '$1[#171717]');
  content = content.replace(/(\btext-white\s+[^"'>]*?\btext-[234]xl\b)/gi, (match) => {
    return match.replace(/\btext-white\b/, 'text-[#171717]');
  });

  // 4. Inputs / Selects / Textareas: garantir texto escuro e placeholder nítido #77766F
  // Substituir text-white dentro de input, select, textarea
  content = content.replace(/(<(?:input|select|textarea)[^>]*?\btext-)white\b/gi, '$1[#171717]');
  content = content.replace(/(<(?:input|select|textarea)[^>]*?\bplaceholder:text-)slate-[45]00\b/gi, '$1[#77766F]');

  // 5. Linhas de tabela <td> com text-white em nomes e títulos -> text-[#171717]
  content = content.replace(/(<td[^>]*?>[\s\S]*?<div[^>]*?\bfont-bold\s+)text-white\b/gi, '$1text-[#171717]');
  content = content.replace(/(<td[^>]*?>[\s\S]*?<span[^>]*?\bfont-bold\s+)text-white\b/gi, '$1text-[#171717]');

  // 6. Cabeçalhos de tabela: remover fundos ultra escuros como bg-slate-900/60
  content = content.replace(/\bbg-slate-900\/60\b/gi, 'bg-[#E3E1DA]');
  content = content.replace(/\bbg-amber-950\/40\b/gi, 'bg-[#FFF8E6]');
  content = content.replace(/\bbg-rose-950\/40\b/gi, 'bg-[#FDF2F2]');

  // 7. Textos secundários apagados text-slate-500 -> text-[#5F5F5F] ou text-[#77766F]
  content = content.replace(/\btext-slate-500\b/gi, 'text-[#5F5F5F]');
  content = content.replace(/\btext-slate-400\b/gi, 'text-[#77766F]');

  // 8. Botões roxos herdados: bg-purple-600 hover:bg-purple-500 -> ArtCraft primary bg-[#222222] hover:bg-black text-white
  content = content.replace(/\bbg-purple-600\s+hover:bg-purple-500\s+text-white\b/gi, 'bg-[#222222] hover:bg-black text-white');
  content = content.replace(/\bbg-purple-600\s+text-white\b/gi, 'bg-[#222222] text-white');

  // 9. Paleta de superfícies conforme seção 2:
  // Fundo geral: #EAE8E2 (substituindo #F3F2EE)
  content = content.replace(/#F3F2EE/gi, '#EAE8E2');
  // Superfície principal: #F7F6F2 (substituindo #FAF9F6)
  content = content.replace(/#FAF9F6/gi, '#F7F6F2');
  // Superfície secundária: #E4E2DB (substituindo #EAE9E4)
  content = content.replace(/#EAE9E4/gi, '#E4E2DB');
  // Bordas: #CFCDC5 (substituindo #D0CFC9)
  content = content.replace(/#D0CFC9/gi, '#CFCDC5');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

let modifiedCount = 0;
for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f.endsWith('.tsx') || f.endsWith('.ts')) {
      const fullPath = path.join(dir, f);
      if (processFile(fullPath)) {
        console.log(`Refined: ${fullPath}`);
        modifiedCount++;
      }
    }
  }
}

console.log(`Finished refining ${modifiedCount} files.`);
