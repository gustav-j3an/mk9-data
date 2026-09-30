import * as XLSX from 'xlsx';
import { ImportType } from '../types';

export interface TemplateSpec {
  type: ImportType;
  title: string;
  columns: string[];
  requiredColumns: string[];
  instructions: {
    finalidade: string;
    obrigatorios: string;
    formatos: string;
    exemplos: string;
    ordem: string;
    duplicidade: string;
    unicidade: string;
    relacionamentos: string;
  };
  auxiliaryLists: {
    statusPermitidos: string[];
    ufsValidas: string[];
  };
}

export const TEMPLATE_SPECS: Record<ImportType, TemplateSpec> = {
  industrias: {
    type: 'industrias',
    title: 'Modelo de Importação - Indústrias',
    columns: ['codigo', 'nome', 'cnpj', 'status', 'observacao'],
    requiredColumns: ['codigo', 'nome'],
    instructions: {
      finalidade: 'Cadastrar marcas, fabricantes e indústrias parceiras de trade marketing no sistema.',
      obrigatorios: 'Colunas [codigo] e [nome] são OBRIGATÓRIAS.',
      formatos: 'CNPJ: 14 dígitos numéricos (ex: 12345678000195). Status: ativo ou inativo.',
      exemplos: 'codigo: IND-001 | nome: Indústria Exemplo S.A. | cnpj: 12345678000195 | status: ativo',
      ordem: '1º PASSO: Importe Indústrias antes de cadastrar Rotas.',
      duplicidade: 'Opção "Upsert": atualiza nome/cnpj se o código já existir. Modo Seguro: rejeita códigos já existentes.',
      unicidade: 'O código da indústria deve ser ÚNICO no sistema.',
      relacionamentos: 'O código cadastrado aqui será referenciado no módulo de Rotas (campo industria_codigo).'
    },
    auxiliaryLists: {
      statusPermitidos: ['ativo', 'inativo'],
      ufsValidas: ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
    }
  },
  lojas: {
    type: 'lojas',
    title: 'Modelo de Importação - Lojas / PDVs',
    columns: ['codigo', 'nome', 'cnpj', 'cidade', 'uf', 'endereco', 'rede', 'status'],
    requiredColumns: ['codigo', 'nome', 'cidade', 'uf'],
    instructions: {
      finalidade: 'Cadastrar os Pontos de Venda (PDVs), lojas e supermercados atendidos pela operação.',
      obrigatorios: 'Colunas [codigo], [nome], [cidade] e [uf] são OBRIGATÓRIAS.',
      formatos: 'UF: Sigla oficial de 2 letras (ex: SP, RJ, MG). CNPJ: 14 dígitos numéricos. Status: ativo ou inativo.',
      exemplos: 'codigo: LOJ-101 | nome: Supermercado Exemplo | cidade: São Paulo | uf: SP | status: ativo',
      ordem: '2º PASSO: Importe Lojas antes de criar Rotas.',
      duplicidade: 'Em modo seguro, códigos já existentes na base serão mantidos sem alterações.',
      unicidade: 'O código da loja deve ser ÚNICO.',
      relacionamentos: 'O código da loja será referenciado nas Rotas operacionais (campo loja_codigo).'
    },
    auxiliaryLists: {
      statusPermitidos: ['ativo', 'inativo'],
      ufsValidas: ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
    }
  },
  promotores: {
    type: 'promotores',
    title: 'Modelo de Importação - Promotores de Campo',
    columns: ['matricula', 'nome', 'cpf', 'telefone', 'email', 'cidade', 'uf', 'supervisor', 'equipe', 'status'],
    requiredColumns: ['matricula', 'nome', 'cidade', 'uf'],
    instructions: {
      finalidade: 'Cadastrar promotores de campo, matrículas, supervisores e equipes de atendimento.',
      obrigatorios: 'Colunas [matricula], [nome], [cidade] e [uf] são OBRIGATÓRIAS.',
      formatos: 'CPF: 11 dígitos. Telefone: 10 ou 11 dígitos com DDD. Status permitidos: ativo, inativo, ferias, afastado, arquivado.',
      exemplos: 'matricula: PRM-001 | nome: Promotor Exemplo | cpf: 12345678901 | cidade: São Paulo | uf: SP | status: ativo',
      ordem: '3º PASSO: Importe Promotores antes de criar Rotas.',
      duplicidade: 'Registros com matrículas duplicadas serão rejeitados se o modo Upsert não estiver ativo.',
      unicidade: 'A matrícula deve ser ÚNICA para cada colaborador.',
      relacionamentos: 'A matrícula do promotor é obrigatória para vinculo em Rotas (campo promotor_matricula).'
    },
    auxiliaryLists: {
      statusPermitidos: ['ativo', 'inativo', 'ferias', 'afastado', 'arquivado'],
      ufsValidas: ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
    }
  },
  rotas: {
    type: 'rotas',
    title: 'Modelo de Importação - Rotas Operacionais',
    columns: ['codigo_rota', 'data', 'promotor_matricula', 'loja_codigo', 'industria_codigo', 'sequencia', 'observacao'],
    requiredColumns: ['codigo_rota', 'data', 'promotor_matricula', 'loja_codigo', 'industria_codigo'],
    instructions: {
      finalidade: 'Vincular e agendar as visitas do promotor aos PDVs e indústrias por data.',
      obrigatorios: 'Colunas [codigo_rota], [data], [promotor_matricula], [loja_codigo] e [industria_codigo] são OBRIGATÓRIAS.',
      formatos: 'Data: formato ISO AAAA-MM-DD (ex: 2026-10-01). Sequencia: número inteiro (1, 2, 3...).',
      exemplos: 'codigo_rota: ROT-001 | data: 2026-10-01 | promotor_matricula: PRM-001 | loja_codigo: LOJ-101 | industria_codigo: IND-001',
      ordem: '4º PASSO (ÚLTIMO): Importe Rotas APÓS cadastrar Promotores, Lojas e Indústrias.',
      duplicidade: 'A combinação de (codigo_rota, data, promotor_matricula, loja_codigo, industria_codigo) é única.',
      unicidade: 'Não repita o mesmo vínculo de rota para a mesma loja/indústria na mesma data.',
      relacionamentos: 'DEPENDÊNCIAS CRÍTICAS: promotor_matricula deve existir em Promotores, loja_codigo deve existir em Lojas e industria_codigo deve existir em Indústrias.'
    },
    auxiliaryLists: {
      statusPermitidos: ['ativo', 'inativo'],
      ufsValidas: ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
    }
  }
};

/**
 * Gera um arquivo XLSX profissional com as abas: LEIA-ME, DADOS e LISTAS_AUXILIARES
 */
export const generateXLSXTemplate = (type: ImportType) => {
  const spec = TEMPLATE_SPECS[type];
  const wb = XLSX.utils.book_new();

  // 1. Aba LEIA-ME
  const readmeData = [
    [spec.title],
    ['INSTRUÇÕES DE PREENCHIMENTO E REGRAS DE IMPORTAÇÃO'],
    [''],
    ['1. FINALIDADE DO ARQUIVO', spec.instructions.finalidade],
    ['2. CAMPOS OBRIGATÓRIOS', spec.instructions.obrigatorios],
    ['3. FORMATOS ACEITOS', spec.instructions.formatos],
    ['4. EXEMPLO GENÉRICO DE ESTRUTURA', spec.instructions.exemplos],
    ['5. ORDEM RECOMENDADA DE IMPORTAÇÃO', spec.instructions.ordem],
    ['6. REGRAS DE DUPLICIDADE', spec.instructions.duplicidade],
    ['7. REGRAS DE UNICIDADE', spec.instructions.unicidade],
    ['8. RELACIONAMENTOS & DEPENDÊNCIAS', spec.instructions.relacionamentos],
    [''],
    ['OBSERVAÇÃO IMPORTANTE:', 'Preencha os dados na aba "DADOS". Não altere o nome do cabeçalho da linha 1.']
  ];
  const wsReadme = XLSX.utils.aoa_to_sheet(readmeData);
  wsReadme['!cols'] = [{ wch: 35 }, { wch: 85 }];
  XLSX.utils.book_append_sheet(wb, wsReadme, 'LEIA-ME');

  // 2. Aba DADOS (Contém APENAS os cabeçalhos limpos sem nenhuma linha fictícia)
  const headerRow = spec.columns.map((col) =>
    spec.requiredColumns.includes(col) ? `${col} (*)` : col
  );
  const cleanHeaderRow = spec.columns; // Cabeçalho exato em minúsculo para leitura
  const wsData = XLSX.utils.aoa_to_sheet([cleanHeaderRow]);
  wsData['!cols'] = spec.columns.map(() => ({ wch: 22 }));

  // Aplicar AutoFiltro no cabeçalho
  const colEndLetter = XLSX.utils.encode_col(spec.columns.length - 1);
  wsData['!autofilter'] = { ref: `A1:${colEndLetter}100` };

  XLSX.utils.book_append_sheet(wb, wsData, 'DADOS');

  // 3. Aba LISTAS_AUXILIARES
  const maxRows = Math.max(spec.auxiliaryLists.statusPermitidos.length, spec.auxiliaryLists.ufsValidas.length);
  const auxData = [['STATUS_PERMITIDOS', 'UFS_VALIDAS']];
  for (let i = 0; i < maxRows; i++) {
    auxData.push([
      spec.auxiliaryLists.statusPermitidos[i] || '',
      spec.auxiliaryLists.ufsValidas[i] || ''
    ]);
  }
  const wsAux = XLSX.utils.aoa_to_sheet(auxData);
  wsAux['!cols'] = [{ wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsAux, 'LISTAS_AUXILIARES');

  // Gerar o buffer e disparar download
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `modelo_${type}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Gera um arquivo CSV limpo (UTF-8, separador vírgula, somente cabeçalho sem dados fictícios)
 */
export const generateCSVTemplate = (type: ImportType) => {
  const spec = TEMPLATE_SPECS[type];
  const csvContent = spec.columns.join(',') + '\n';
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `modelo_${type}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
