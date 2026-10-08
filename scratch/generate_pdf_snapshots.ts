import React from 'react';
import ReactDOMServer from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ExecutiveReportDocument } from '../src/components/reports/ExecutiveReportDocument';

// Carregar o CSS gerado no build
const cssPath = path.resolve(process.cwd(), 'dist/assets/index-DyGeH2Js.css');
let cssContent = '';
if (fs.existsSync(cssPath)) {
  cssContent = fs.readFileSync(cssPath, 'utf-8');
} else {
  console.log('CSS do dist não encontrado. Executando npm run build...');
  execSync('npm run build', { stdio: 'inherit' });
  const distFiles = fs.readdirSync(path.resolve(process.cwd(), 'dist/assets'));
  const cssFile = distFiles.find(f => f.endsWith('.css'));
  if (cssFile) {
    cssContent = fs.readFileSync(path.resolve(process.cwd(), 'dist/assets', cssFile), 'utf-8');
  }
}

// Dados para Caso Normal (6 promotores, 5 lojas)
const dataNormal = {
  activeIndName: 'BEBIDAS YPÊ S/A',
  activeIndCode: 'IND-YPE-001',
  periodFilter: 'month' as const,
  kpis: {
    lojas: 42,
    lojasComVisita: 38,
    planejadas: 180,
    concluidas: 165,
    emAndamento: 3,
    pendentes: 12,
    pendentesHoje: 4,
    atrasadas: 8,
    naoRealizadas: 3,
    aderencia: 92
  },
  promotoresPerformance: [
    { matricula: 'PROM-001', nome: 'CARLOS ALBERTO SILVA', planejadas: 30, concluidas: 29, pendentes: 1, atrasadas: 0, aderencia: 97 },
    { matricula: 'PROM-002', nome: 'MARIANA OLIVEIRA SANTOS', planejadas: 30, concluidas: 28, pendentes: 2, atrasadas: 1, aderencia: 93 },
    { matricula: 'PROM-003', nome: 'ROBERTO ALVES FERREIRA', planejadas: 30, concluidas: 27, pendentes: 3, atrasadas: 2, aderencia: 90 },
    { matricula: 'PROM-004', nome: 'FERNANDA LIMA GOMES', planejadas: 30, concluidas: 29, pendentes: 1, atrasadas: 0, aderencia: 97 },
    { matricula: 'PROM-005', nome: 'LUCAS MARTINS ROCHA', planejadas: 30, concluidas: 26, pendentes: 4, atrasadas: 3, aderencia: 87 },
    { matricula: 'PROM-006', nome: 'BEATRIZ CASTRO SOUZA', planejadas: 30, concluidas: 26, pendentes: 4, atrasadas: 2, aderencia: 87 }
  ],
  occurrencesSummary: { rupturas: 8, preco: 4, espaco: 3, outros: 2, total: 17 },
  validitySummary: { totalAuditados: 450, vencidos: 2, vencendo3d: 5, vencendo7d: 12, vencendo30d: 35 },
  photosSummary: { fachada: 42, gondola: 120, preco: 45, ponto_extra: 15, ruptura: 8, outros: 5, total: 235 },
  temporalEvolution: [
    { dateStr: '2026-10-01', dayShort: 'Sex', planejadas: 30, realizadas: 29, pendentes: 1 },
    { dateStr: '2026-10-02', dayShort: 'Sáb', planejadas: 30, realizadas: 28, pendentes: 2 },
    { dateStr: '2026-10-03', dayShort: 'Dom', planejadas: 30, realizadas: 27, pendentes: 3 },
    { dateStr: '2026-10-04', dayShort: 'Seg', planejadas: 30, realizadas: 29, pendentes: 1 },
    { dateStr: '2026-10-05', dayShort: 'Ter', planejadas: 30, realizadas: 26, pendentes: 4 },
    { dateStr: '2026-10-06', dayShort: 'Qua', planejadas: 30, realizadas: 26, pendentes: 4 }
  ],
  topProblematicLojas: [
    { codigo: 'LOJA-101', nome: 'SUPERMERCADO HYPERMARCAS LOJA 1 - CENTRO', cidade: 'São Paulo', uf: 'SP', planejadas: 12, concluidas: 8, atrasadas: 3, aderencia: 67 },
    { codigo: 'LOJA-102', nome: 'ATACADÃO ZONA SUL - FILIAL 04', cidade: 'Campinas', uf: 'SP', planejadas: 10, concluidas: 7, atrasadas: 2, aderencia: 70 },
    { codigo: 'LOJA-103', nome: 'HIPERMERCADO EXTRA - SHOPPING', cidade: 'Osasco', uf: 'SP', planejadas: 15, concluidas: 11, atrasadas: 2, aderencia: 73 },
    { codigo: 'LOJA-104', nome: 'REDE CARREFOUR - LOJA 12', cidade: 'Guarulhos', uf: 'SP', planejadas: 8, concluidas: 6, atrasadas: 1, aderencia: 75 },
    { codigo: 'LOJA-105', nome: 'SUPERMERCADO PAO DE ACUCAR - BAIRRO', cidade: 'São Paulo', uf: 'SP', planejadas: 14, concluidas: 11, atrasadas: 1, aderencia: 78 }
  ]
};

// Dados para Caso Grande (15 promotores, 10 lojas)
const dataLarge = {
  ...dataNormal,
  promotoresPerformance: [
    ...dataNormal.promotoresPerformance,
    { matricula: 'PROM-007', nome: 'GABRIEL NOGUEIRA SANTOS', planejadas: 25, concluidas: 22, pendentes: 3, atrasadas: 1, aderencia: 88 },
    { matricula: 'PROM-008', nome: 'PATRICIA BARBOSA COSTA', planejadas: 25, concluidas: 20, pendentes: 5, atrasadas: 3, aderencia: 80 },
    { matricula: 'PROM-009', nome: 'THIAGO CORREA MACHADO', planejadas: 25, concluidas: 24, pendentes: 1, atrasadas: 0, aderencia: 96 },
    { matricula: 'PROM-010', nome: 'JULIANA TEIXEIRA MENDEZ', planejadas: 25, concluidas: 21, pendentes: 4, atrasadas: 2, aderencia: 84 },
    { matricula: 'PROM-011', nome: 'RENATO MONTEIRO SILVA', planejadas: 25, concluidas: 19, pendentes: 6, atrasadas: 4, aderencia: 76 },
    { matricula: 'PROM-012', nome: 'CAMILA FREITAS CARDOSO', planejadas: 25, concluidas: 23, pendentes: 2, atrasadas: 1, aderencia: 92 },
    { matricula: 'PROM-013', nome: 'EDSON PEREIRA ARAUJO', planejadas: 25, concluidas: 25, pendentes: 0, atrasadas: 0, aderencia: 100 },
    { matricula: 'PROM-014', nome: 'VANESSA DUARTE RIBEIRO', planejadas: 25, concluidas: 22, pendentes: 3, atrasadas: 1, aderencia: 88 },
    { matricula: 'PROM-015', nome: 'ALESSANDRO REIS SANTOS', planejadas: 25, concluidas: 18, pendentes: 7, atrasadas: 5, aderencia: 72 }
  ],
  topProblematicLojas: [
    ...dataNormal.topProblematicLojas,
    { codigo: 'LOJA-106', nome: 'SUPERMERCADO DIA - UNIDADE VILA MARIANA', cidade: 'São Paulo', uf: 'SP', planejadas: 10, concluidas: 7, atrasadas: 2, aderencia: 70 },
    { codigo: 'LOJA-107', nome: 'ASSAI ATACADISTA - AVENIDA CENTRAL', cidade: 'Santo André', uf: 'SP', planejadas: 12, concluidas: 9, atrasadas: 2, aderencia: 75 },
    { codigo: 'LOJA-108', nome: 'ATACADAO DOS ALIMENTOS - FILIAL 02', cidade: 'São Bernardo', uf: 'SP', planejadas: 8, concluidas: 6, atrasadas: 1, aderencia: 75 },
    { codigo: 'LOJA-109', nome: 'SUPERMERCADO SONDA - MOOCA', cidade: 'São Paulo', uf: 'SP', planejadas: 11, concluidas: 8, atrasadas: 2, aderencia: 72 },
    { codigo: 'LOJA-110', nome: 'REDE WALMART - SHOPPING INTERLAGOS', cidade: 'São Paulo', uf: 'SP', planejadas: 15, concluidas: 10, atrasadas: 4, aderencia: 66 }
  ]
};

function renderHTML(props: any, title: string) {
  const jsx = React.createElement(ExecutiveReportDocument, props);
  const bodyHtml = ReactDOMServer.renderToStaticMarkup(jsx);
  const visibleHtml = bodyHtml.replace('hidden print:block', 'block');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    ${cssContent}
    @page {
      size: A4 portrait;
      margin: 0;
    }
  </style>
</head>
<body class="bg-white">
  <div id="root">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

const htmlNormal = renderHTML(dataNormal, 'PDF Report Normal');
const htmlLarge = renderHTML(dataLarge, 'PDF Report Large');

const scratchDir = path.resolve(process.cwd(), 'scratch');
if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

const htmlNormalPath = path.join(scratchDir, 'report_normal.html');
const htmlLargePath = path.join(scratchDir, 'report_large.html');

fs.writeFileSync(htmlNormalPath, htmlNormal);
fs.writeFileSync(htmlLargePath, htmlLarge);

console.log('Arquivos HTML salvos em:', scratchDir);

// Gerar PDFs usando Chrome Headless
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const pdfNormalPath = path.join(scratchDir, 'report_normal.pdf');
const pdfLargePath = path.join(scratchDir, 'report_large.pdf');

const fileUrlNormal = 'file:///' + htmlNormalPath.replace(/\\/g, '/');
const fileUrlLarge = 'file:///' + htmlLargePath.replace(/\\/g, '/');

console.log('Gerando PDF Caso Normal...');
execSync(`"${chromePath}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfNormalPath}" "${fileUrlNormal}"`);

console.log('Gerando PDF Caso Grande...');
execSync(`"${chromePath}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfLargePath}" "${fileUrlLarge}"`);

console.log('PDFs gerados com sucesso!');
