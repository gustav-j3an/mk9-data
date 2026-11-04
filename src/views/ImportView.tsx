import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
import type { ToastMessage, ImportType, ImportRowError, ImportHistoryRecord } from '../types';
import { generateXLSXTemplate, generateCSVTemplate, TEMPLATE_SPECS } from '../utils/templateGenerator';

interface ImportViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

// Funções de Validação de Formato
const validateCPF = (cpf: string) => {
  const clean = cpf.replace(/\D/g, '');
  return clean.length === 11;
};

const validateCNPJ = (cnpj: string) => {
  const clean = cnpj.replace(/\D/g, '');
  return clean.length === 14;
};

const validatePhone = (phone: string) => {
  const clean = phone.replace(/\D/g, '');
  return clean.length >= 10 && clean.length <= 11;
};

const validateUF = (uf: string) => {
  const validUFs = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
    'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ];
  return validUFs.includes(uf.toUpperCase().trim());
};

const validateDate = (dateStr: string) => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
};

const validateStatus = (status: string) => {
  const allowed = ['ativo', 'inativo', 'ferias', 'afastado', 'arquivado'];
  return allowed.includes(status.toLowerCase().trim());
};

// Helper simples de conversão CSV em Array de Objetos
const parseCSV = (text: string): { headers: string[]; rows: Record<string, string>[] } => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const rawHeaders = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''));
    if (values.length === rawHeaders.length) {
      const rowObj: Record<string, string> = {};
      rawHeaders.forEach((h, idx) => {
        rowObj[h] = values[idx] || '';
      });
      rows.push(rowObj);
    }
  }

  return { headers: rawHeaders, rows };
};

export const ImportView: React.FC<ImportViewProps> = ({ onShowToast }) => {
  const { profile } = useAuth();
  const [selectedType, setSelectedType] = useState<ImportType>('industrias');
  const [allowUpsert, setAllowUpsert] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Estados da Prévia e Validação
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [acceptedRows, setAcceptedRows] = useState<Record<string, string>[]>([]);
  const [rejectedRows, setRejectedRows] = useState<{ row: Record<string, string>; errors: ImportRowError[] }[]>([]);
  const [validationErrors, setValidationErrors] = useState<ImportRowError[]>([]);
  const [step, setStep] = useState<'upload' | 'preview' | 'history'>('upload');

  // Histórico de Importações
  const [history, setHistory] = useState<ImportHistoryRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    if (!supabase) {
      setLoadingHistory(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('import_history')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Erro ao carregar histórico:', error.message);
      } else if (data) {
        setHistory(data as ImportHistoryRecord[]);
      }
    } catch (e) {
      console.error('Erro ao buscar histórico de importação:', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (step === 'history') {
      fetchHistory();
    }
  }, [step]);

  // Handlers para Download dos Novos Modelos
  const handleDownloadXLSX = (type: ImportType) => {
    generateXLSXTemplate(type);
    onShowToast({
      title: 'Modelo XLSX Gerado',
      message: `Modelo modelo_${type}.xlsx baixado com abas LEIA-ME, DADOS e LISTAS_AUXILIARES.`,
      type: 'info'
    });
  };

  const handleDownloadCSV = (type: ImportType) => {
    generateCSVTemplate(type);
    onShowToast({
      title: 'Modelo CSV Limpo Gerado',
      message: `Modelo modelo_${type}.csv baixado com cabeçalho limpo.`,
      type: 'info'
    });
  };

  // Normalização de string: remove acentos, espaços extras e converte para minúsculo
  const normalizeHeader = (str: string): string => {
    return str
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '');
  };

  // Helper para converter marcações de dia em boolean
  const isDayMarked = (val?: any): boolean => {
    if (val === null || val === undefined) return false;
    const str = String(val).trim();
    if (!str) return false;
    const clean = normalizeHeader(str);
    if (['sim', 'x', '1', 'v', 'verdadeiro', 'marcado', 'true', 's'].includes(clean)) return true;
    if (['check', 'checked', 'ok', 'yes', 'y'].includes(clean)) return true;
    // Qualquer outro texto preenchido diferente de "nao"/"0"/"false"
    if (!['nao', '0', 'false', 'f', 'n'].includes(clean) && str.length > 0) {
      return true;
    }
    return false;
  };

  // Processador de arquivos XLSX/CSV
  const processSpreadsheetFile = async (uploadedFile: File) => {
    const arrayBuffer = await uploadedFile.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });

    const ignoredSheets = ['LEIA-ME', 'LEIAME', 'INSTRUÇÕES', 'INSTRUCOES', 'LISTAS_AUXILIARES', 'LISTAS AUXILIARES', 'CONFIG', 'CONFIGURAÇÕES', 'CONFIGURACOES'];
    let targetSheetName = '';

    // Priorizar aba "DADOS"
    const exactDados = wb.SheetNames.find((name) => normalizeHeader(name) === 'dados');
    if (exactDados) {
      targetSheetName = exactDados;
    } else {
      // Procurar primeira aba que não esteja na lista de ignoradas e contenha dados
      for (const sheetName of wb.SheetNames) {
        const normName = normalizeHeader(sheetName);
        if (!ignoredSheets.map(normalizeHeader).includes(normName)) {
          const sheet = wb.Sheets[sheetName];
          if (sheet) {
            const rawData = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
            if (rawData && rawData.length > 0) {
              targetSheetName = sheetName;
              break;
            }
          }
        }
      }
    }

    if (!targetSheetName) {
      // Se não achou nenhuma diferente, usa a primeira disponível que tenha dados
      targetSheetName = wb.SheetNames[0];
    }

    const sheet = wb.Sheets[targetSheetName];
    if (!sheet) {
      return { headers: [], rawHeadersMap: {}, rows: [] };
    }

    const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rawRows || rawRows.length === 0) {
      return { headers: [], rawHeadersMap: {}, rows: [] };
    }

    // Encontrar linha de cabeçalho real
    let headerRowIndex = -1;
    let normalizedHeaders: string[] = [];
    const headerMap: Record<string, string> = {}; // normalized -> original trimmed header

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!Array.isArray(row)) continue;
      const rowNorms = row.map((cell) => normalizeHeader(String(cell || '')));
      
      // Se a linha tem pelo menos um dos cabeçalhos chave de rotas ou indústrias/lojas/promotores
      const hasRotaHeaders = ['industria', 'loja', 'promotor', 'frequencia'].every((h) => rowNorms.includes(h));
      const hasIndHeaders = rowNorms.includes('codigo') && rowNorms.includes('nome');
      const hasPromHeaders = rowNorms.includes('matricula') || (rowNorms.includes('nome') && rowNorms.includes('cidade'));

      if (hasRotaHeaders || hasIndHeaders || hasPromHeaders || rowNorms.some((n) => n.length > 0)) {
        headerRowIndex = i;
        row.forEach((cell) => {
          const origStr = String(cell || '').trim();
          const norm = normalizeHeader(origStr);
          if (norm) {
            normalizedHeaders.push(norm);
            headerMap[norm] = origStr;
          }
        });
        break;
      }
    }

    if (headerRowIndex === -1) {
      return { headers: [], rawHeadersMap: {}, rows: [] };
    }

    const rows: Record<string, string>[] = [];
    for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
      const rowValues = rawRows[i];
      if (!Array.isArray(rowValues)) continue;

      // Verificar se a linha não é totalmente em branco
      const hasValue = rowValues.some((v) => String(v ?? '').trim() !== '');
      if (!hasValue) continue;

      const rowObj: Record<string, string> = {};
      normalizedHeaders.forEach((normHeader, colIdx) => {
        const rawVal = rowValues[colIdx];
        rowObj[normHeader] = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : '';
      });
      rows.push(rowObj);
    }

    return { headers: normalizedHeaders, rawHeadersMap: headerMap, rows };
  };

  // Leitura e Detecção Automática do Tipo de Planilha
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setParsing(true);

    try {
      const { headers, rows } = await processSpreadsheetFile(uploadedFile);

      if (rows.length === 0) {
        onShowToast({
          title: 'Planilha Sem Registros',
          message: 'A planilha fornecida contém apenas o cabeçalho ou está vazia.',
          type: 'warning'
        });
        setParsing(false);
        return;
      }

      // Detecção Automática pelo Cabeçalho
      let detectedType: ImportType = selectedType;
      const isRotas = ['industria', 'loja', 'promotor', 'frequencia'].every((h) => headers.includes(h)) ||
        (headers.includes('industria') && headers.includes('loja') && headers.includes('promotor'));

      if (isRotas) {
        detectedType = 'rotas';
      } else if (headers.includes('matricula') || headers.includes('supervisor')) {
        detectedType = 'promotores';
      } else if (headers.includes('endereco') || headers.includes('rede')) {
        detectedType = 'lojas';
      } else if (headers.includes('codigo') && headers.includes('nome')) {
        detectedType = 'industrias';
      }

      setSelectedType(detectedType);
      setParsedRows(rows);
      validateData(rows, detectedType);
      setStep('preview');
    } catch (err) {
      console.error(err);
      onShowToast({
        title: 'Erro de Leitura',
        message: 'Não foi possível ler o arquivo. Certifique-se que é um CSV/XLSX válido.',
        type: 'error'
      });
    } finally {
      setParsing(false);
    }
  };

  // Validação Estrita de Colunas e Formatos
  const validateData = (rows: Record<string, string>[], type: ImportType) => {
    const accepted: Record<string, string>[] = [];
    const rejected: { row: Record<string, string>; errors: ImportRowError[] }[] = [];
    const allErrors: ImportRowError[] = [];
    const seenKeys = new Set<string>();

    rows.forEach((row, idx) => {
      const rowNum = idx + 2; // Linha 1 é cabeçalho
      const rowErrors: ImportRowError[] = [];

      if (type === 'industrias') {
        if (!row.codigo?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'codigo', value: '', message: 'Campo obrigatório.' });
        if (!row.nome?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'nome', value: '', message: 'Campo obrigatório.' });
        if (row.cnpj?.trim() && !validateCNPJ(row.cnpj)) rowErrors.push({ rowNumber: rowNum, column: 'cnpj', value: row.cnpj, message: 'CNPJ inválido (deve ter 14 dígitos).' });
        if (row.status?.trim() && !validateStatus(row.status)) rowErrors.push({ rowNumber: rowNum, column: 'status', value: row.status, message: 'Status inválido. Permitidos: ativo, inativo.' });

        if (row.codigo?.trim()) {
          if (seenKeys.has(row.codigo.trim())) {
            rowErrors.push({ rowNumber: rowNum, column: 'codigo', value: row.codigo, message: 'Código duplicado na mesma planilha.' });
          } else {
            seenKeys.add(row.codigo.trim());
          }
        }
      } else if (type === 'lojas') {
        if (!row.codigo?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'codigo', value: '', message: 'Campo obrigatório.' });
        if (!row.nome?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'nome', value: '', message: 'Campo obrigatório.' });
        if (!row.cidade?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'cidade', value: '', message: 'Campo obrigatório.' });
        if (!row.uf?.trim() || !validateUF(row.uf)) rowErrors.push({ rowNumber: rowNum, column: 'uf', value: row.uf || '', message: 'UF inválida (ex: SP, RJ, MG).' });
        if (row.cnpj?.trim() && !validateCNPJ(row.cnpj)) rowErrors.push({ rowNumber: rowNum, column: 'cnpj', value: row.cnpj, message: 'CNPJ inválido.' });
        if (row.status?.trim() && !validateStatus(row.status)) rowErrors.push({ rowNumber: rowNum, column: 'status', value: row.status, message: 'Status inválido. Permitidos: ativo, inativo.' });

        if (row.codigo?.trim()) {
          if (seenKeys.has(row.codigo.trim())) {
            rowErrors.push({ rowNumber: rowNum, column: 'codigo', value: row.codigo, message: 'Código de loja duplicado.' });
          } else {
            seenKeys.add(row.codigo.trim());
          }
        }
      } else if (type === 'promotores') {
        if (!row.matricula?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'matricula', value: '', message: 'Campo obrigatório.' });
        if (!row.nome?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'nome', value: '', message: 'Campo obrigatório.' });
        if (!row.cidade?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'cidade', value: '', message: 'Campo obrigatório.' });
        if (!row.uf?.trim() || !validateUF(row.uf)) rowErrors.push({ rowNumber: rowNum, column: 'uf', value: row.uf || '', message: 'UF inválida.' });
        if (row.cpf?.trim() && !validateCPF(row.cpf)) rowErrors.push({ rowNumber: rowNum, column: 'cpf', value: row.cpf, message: 'CPF inválido (deve ter 11 dígitos).' });
        if (row.telefone?.trim() && !validatePhone(row.telefone)) rowErrors.push({ rowNumber: rowNum, column: 'telefone', value: row.telefone, message: 'Telefone inválido (10 a 11 dígitos).' });
        if (row.status?.trim() && !validateStatus(row.status)) rowErrors.push({ rowNumber: rowNum, column: 'status', value: row.status, message: 'Status inválido. Permitidos: ativo, inativo, ferias, afastado, arquivado.' });

        if (row.matricula?.trim()) {
          if (seenKeys.has(row.matricula.trim())) {
            rowErrors.push({ rowNumber: rowNum, column: 'matricula', value: row.matricula, message: 'Matrícula duplicada.' });
          } else {
            seenKeys.add(row.matricula.trim());
          }
        }
      } else if (type === 'rotas') {
        const ind = row.industria?.trim() || row.industria_codigo?.trim();
        const loj = row.loja?.trim() || row.loja_codigo?.trim();
        const prm = row.promotor?.trim() || row.promotor_matricula?.trim();
        const freq = row.frequencia?.trim()?.toUpperCase();

        if (!ind) rowErrors.push({ rowNumber: rowNum, column: 'industria', value: '', message: 'Campo obrigatório (código da indústria).' });
        if (!loj) rowErrors.push({ rowNumber: rowNum, column: 'loja', value: '', message: 'Campo obrigatório (código da loja).' });
        if (!prm) rowErrors.push({ rowNumber: rowNum, column: 'promotor', value: '', message: 'Campo obrigatório (matrícula do promotor).' });

        if (!freq || !['SEMANAL', 'QUINZENAL'].includes(freq)) {
          rowErrors.push({ rowNumber: rowNum, column: 'frequencia', value: row.frequencia || '', message: 'Frequência inválida. Permitidos: SEMANAL ou QUINZENAL.' });
        }

        const seg = isDayMarked(row.segunda);
        const ter = isDayMarked(row.terca);
        const qua = isDayMarked(row.quarta);
        const qui = isDayMarked(row.quinta);
        const sex = isDayMarked(row.sexta);
        const sab = isDayMarked(row.sabado);
        const dom = isDayMarked(row.domingo);

        if (!seg && !ter && !qua && !qui && !sex && !sab && !dom) {
          rowErrors.push({ rowNumber: rowNum, column: 'dias_semana', value: 'NENHUM', message: 'Exigido marcar pelo menos 1 dia da semana (segunda..domingo).' });
        }

        const uniqueKey = `${prm}_${loj}_${ind}`;
        if (seenKeys.has(uniqueKey)) {
          rowErrors.push({ rowNumber: rowNum, column: 'promotor', value: `${prm}/${loj}/${ind}`, message: 'Combinação duplicada de Promotor, Loja e Indústria na mesma planilha.' });
        } else {
          seenKeys.add(uniqueKey);
        }
      }

      if (rowErrors.length > 0) {
        rejected.push({ row, errors: rowErrors });
        allErrors.push(...rowErrors);
      } else {
        accepted.push(row);
      }
    });

    setAcceptedRows(accepted);
    setRejectedRows(rejected);
    setValidationErrors(allErrors);
  };

  // Gravação no Supabase após Confirmação Explícita
  const handleConfirmImport = async () => {
    if (acceptedRows.length === 0) {
      onShowToast({
        title: 'Nenhum Registro Aceito',
        message: 'Não há linhas válidas para importar nesta planilha.',
        type: 'warning'
      });
      return;
    }

    setSaving(true);

    try {
      if (supabase) {
        // Formatação final para inserção no banco de dados conforme esquema
        const dbPayload = acceptedRows.map((r) => {
          if (selectedType === 'rotas') {
            return {
              codigo_rota: r.codigo_rota?.trim() || `ROT-${(r.promotor || r.promotor_matricula || 'GERAL').trim()}`,
              industria_codigo: (r.industria || r.industria_codigo || '').trim(),
              loja_codigo: (r.loja || r.loja_codigo || '').trim(),
              promotor_matricula: (r.promotor || r.promotor_matricula || '').trim(),
              uf: r.uf?.trim() || null,
              frequencia: (r.frequencia || 'SEMANAL').trim().toUpperCase(),
              segunda: isDayMarked(r.segunda),
              terca: isDayMarked(r.terca),
              quarta: isDayMarked(r.quarta),
              quinta: isDayMarked(r.quinta),
              sexta: isDayMarked(r.sexta),
              sabado: isDayMarked(r.sabado),
              domingo: isDayMarked(r.domingo),
              observacao: r.observacao?.trim() || null
            };
          }
          return r;
        });

        // Gravar Registros Aceitos na Tabela Destino
        if (allowUpsert) {
          const onConflictKey =
            selectedType === 'industrias' ? 'codigo' :
            selectedType === 'lojas' ? 'codigo' :
            selectedType === 'promotores' ? 'matricula' : 'rota_ativa_chave';

          const { error: upsertErr } = await supabase
            .from(selectedType)
            .upsert(dbPayload, { onConflict: onConflictKey });

          if (upsertErr) throw upsertErr;
        } else {
          const { error: insertErr } = await supabase
            .from(selectedType)
            .insert(dbPayload);

          if (insertErr) throw insertErr;
        }

        // Gravar Registro de Histórico
        await supabase.from('import_history').insert([
          {
            tipo: selectedType,
            filename: file?.name || 'importacao.csv',
            imported_by_id: profile?.id,
            imported_by_email: profile?.email || 'desconhecido',
            imported_by_name: profile?.name || 'Usuário MK9',
            rows_total: parsedRows.length,
            rows_accepted: acceptedRows.length,
            rows_rejected: rejectedRows.length,
            is_upsert: allowUpsert,
            errors_summary: validationErrors
          }
        ]);
      }

      onShowToast({
        title: 'Importação Concluída',
        message: `${acceptedRows.length} registros importados com sucesso em ${selectedType.toUpperCase()}.`,
        type: 'success'
      });

      // Limpar formulário e ir para histórico
      setStep('history');
      setFile(null);
      setParsedRows([]);
      setAcceptedRows([]);
      setRejectedRows([]);
    } catch (err: any) {
      onShowToast({
        title: 'Falha na Gravação',
        message: `Erro ao gravar no banco: ${err.message || String(err)}`,
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const currentSpec = TEMPLATE_SPECS[selectedType];

  return (
    <div className="w-full px-4 lg:px-8 py-4 sm:py-5 max-w-[1720px] mx-auto space-y-5 font-sans">
      {/* Top Header */}
      <section className="flex flex-col gap-3 border-b border-[#CFCDC5] pb-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-800 ring-1 ring-violet-200">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">upload_file</span>
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-[#171717] sm:text-2xl">
              Importação de Dados por Planilha
            </h1>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#57564F] sm:text-sm">
            Importe <code className="font-mono font-semibold text-violet-800">Indústrias</code>, <code className="font-mono font-semibold text-cyan-800">Lojas</code>, <code className="font-mono font-semibold text-emerald-800">Promotores</code> e <code className="font-mono font-semibold text-amber-800">Rotas</code> com validação prévia.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setStep(step === 'history' ? 'upload' : 'history')}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#B9B7AE] bg-white px-3.5 py-2 text-xs font-semibold text-[#292822] transition-colors hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            {step === 'history' ? 'upload_file' : 'history'}
          </span>
          <span>{step === 'history' ? 'Nova Importação' : 'Histórico de Cargas'}</span>
        </button>
      </section>

      {/* VIEW: UPLOAD */}
      {step === 'upload' && (
        <section className="space-y-4" aria-label="Configuração da importação">
          <div className="space-y-4 rounded-xl border border-[#CFCDC5] bg-[#F7F6F2] p-4 shadow-sm sm:p-5">
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined mt-0.5 text-lg text-violet-800" aria-hidden="true">tune</span>
              <div>
                <h2 className="text-sm font-bold tracking-wide text-[#25241F]">1. Escolha o cadastro e baixe o modelo</h2>
                <p className="mt-0.5 text-xs text-[#57564F]">Selecione um tipo de planilha. Os modelos XLSX e CSV já vêm com os campos correspondentes.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(['industrias', 'lojas', 'promotores', 'rotas'] as ImportType[]).map((type) => {
                const spec = TEMPLATE_SPECS[type];
                const isSelected = selectedType === type;
                return (
                  <article
                    key={type}
                    className={`flex h-full flex-col overflow-hidden rounded-xl border transition-colors ${
                      isSelected
                        ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-200'
                        : 'border-[#CFCDC5] bg-white hover:border-[#A9A69B]'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedType(type)}
                      className="flex min-h-[112px] w-full flex-1 flex-col p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-600"
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className={`text-sm font-bold uppercase tracking-wide ${isSelected ? 'text-violet-950' : 'text-[#292822]'}`}>
                          {type}
                        </span>
                        <span className={`material-symbols-outlined text-xl ${isSelected ? 'text-violet-800' : 'text-[#57564F]'}`} aria-hidden="true">
                          {type === 'industrias' ? 'factory' : type === 'lojas' ? 'store' : type === 'promotores' ? 'badge' : 'alt_route'}
                        </span>
                      </span>
                      <span className="mt-2 text-xs leading-relaxed text-[#57564F]">
                        {type === 'industrias' && 'Marcas e indústrias parceiras.'}
                        {type === 'lojas' && 'PDVs, redes e endereços.'}
                        {type === 'promotores' && 'Matrículas e equipes.'}
                        {type === 'rotas' && 'Vínculos diários de visitas.'}
                      </span>
                      <span className={`mt-auto pt-2 text-[11px] font-semibold ${isSelected ? 'text-violet-800' : 'text-[#57564F]'}`}>
                        {isSelected ? 'Tipo selecionado' : 'Selecionar este cadastro'}
                      </span>
                    </button>

                    <div className="flex items-center gap-2 border-t border-[#E2E0D8] px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => handleDownloadXLSX(type)}
                        className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-50 px-2 text-[11px] font-bold text-emerald-900 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-1"
                        title="Baixar modelo XLSX completo"
                      >
                        <span className="material-symbols-outlined text-[15px]" aria-hidden="true">grid_on</span>
                        XLSX
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadCSV(type)}
                        className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-cyan-800 bg-cyan-50 px-2 text-[11px] font-bold text-cyan-950 transition-colors hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-800 focus-visible:ring-offset-1"
                        title="Baixar modelo CSV com cabeçalho UTF-8"
                      >
                        <span className="material-symbols-outlined text-[15px]" aria-hidden="true">csv</span>
                        CSV
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <section className="rounded-lg border border-[#D5D2C8] bg-[#F0EEE8] p-3.5 sm:p-4" aria-labelledby="import-instructions-heading">
              <div className="mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-violet-800" aria-hidden="true">info</span>
                <h3 id="import-instructions-heading" className="text-xs font-bold uppercase tracking-wide text-[#292822]">
                  Orientações: {currentSpec.title}
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
                <div>
                  <h4 className="font-bold text-[#57564F]">Finalidade</h4>
                  <p className="mt-0.5 leading-relaxed text-[#292822]">{currentSpec.instructions.finalidade}</p>
                </div>
                <div>
                  <h4 className="font-bold text-[#57564F]">Campos obrigatórios</h4>
                  <p className="mt-0.5 font-mono leading-relaxed text-amber-900">{currentSpec.instructions.obrigatorios}</p>
                </div>
                <div>
                  <h4 className="font-bold text-[#57564F]">Ordem de importação</h4>
                  <p className="mt-0.5 font-mono leading-relaxed text-violet-900">{currentSpec.instructions.ordem}</p>
                </div>
                <div>
                  <h4 className="font-bold text-[#57564F]">Dependências e relacionamentos</h4>
                  <p className="mt-0.5 font-mono leading-relaxed text-cyan-950">{currentSpec.instructions.relacionamentos}</p>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4" aria-labelledby="import-mode-heading">
              <div>
                <h3 id="import-mode-heading" className="text-xs font-bold text-[#292822]">Modo de gravação</h3>
                <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-[#57564F]">
                  O padrão preserva os registros existentes. Ative o Upsert somente se quiser atualizar registros que tenham chaves duplicadas.
                </p>
              </div>
              <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#292822] transition-colors hover:bg-amber-100 focus-within:ring-2 focus-within:ring-amber-700 focus-within:ring-offset-1">
                <input
                  type="checkbox"
                  checked={allowUpsert}
                  onChange={(e) => setAllowUpsert(e.target.checked)}
                  className="h-5 w-5 accent-amber-800 focus-visible:outline-none"
                />
                <span>{allowUpsert ? 'Upsert ativado' : 'Atualizar duplicados (Upsert)'}</span>
              </label>
            </section>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-dashed border-violet-400 bg-violet-50/70 p-5 text-center transition-colors hover:border-violet-600 hover:bg-violet-50 focus-within:ring-2 focus-within:ring-violet-600 focus-within:ring-offset-2 sm:p-7">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              aria-label="Selecionar planilha preenchida em CSV ou Excel"
              aria-describedby="import-file-help"
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            />
            <div className="pointer-events-none mx-auto flex max-w-2xl flex-col items-center">
              <span className="material-symbols-outlined mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-white text-3xl text-violet-800 ring-1 ring-violet-200" aria-hidden="true">cloud_upload</span>
              <h3 className="text-sm font-bold text-[#25241F]">Arraste ou selecione sua planilha</h3>
              <p id="import-file-help" className="mt-1 text-xs text-[#57564F]">
                Arquivos CSV ou XLSX para <strong>{selectedType.toUpperCase()}</strong>. A validação acontece antes de qualquer gravação.
              </p>
              <span className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg bg-violet-800 px-4 py-2 text-xs font-bold text-white shadow-sm">
                Selecionar Arquivo Preenchido
              </span>
            </div>
          </div>
        </section>
      )}
      {/* VIEW: PRÉVIA E VALIDAÇÃO */}
      {step === 'preview' && (
        <section className="space-y-6">
          {/* Card Resumo de Validação */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="p-5 rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-xl">
              <div className="flex items-center justify-between text-[#77766F] font-mono text-xs">
                <span>TOTAL DE LINHAS LIDAS</span>
                <span className="material-symbols-outlined text-purple-400">format_list_numbered</span>
              </div>
              <div className="text-3xl font-extrabold text-[#171717] font-mono mt-2">{parsedRows.length}</div>
            </div>

            <div className="p-5 rounded-2xl bg-[#F7F6F2] border border-emerald-500/30 shadow-xl">
              <div className="flex items-center justify-between text-emerald-400 font-mono text-xs font-bold">
                <span>ACEITAS PARA IMPORTAÇÃO</span>
                <span className="material-symbols-outlined">check_circle</span>
              </div>
              <div className="text-3xl font-extrabold text-emerald-400 font-mono mt-2">{acceptedRows.length}</div>
            </div>

            <div className="p-5 rounded-2xl bg-[#F7F6F2] border border-rose-500/30 shadow-xl">
              <div className="flex items-center justify-between text-rose-400 font-mono text-xs font-bold">
                <span>REJEITADAS COM ERRO</span>
                <span className="material-symbols-outlined">warning</span>
              </div>
              <div className="text-3xl font-extrabold text-rose-400 font-mono mt-2">{rejectedRows.length}</div>
            </div>
          </div>

          {/* Relatório de Erros por Linha e Coluna */}
          {validationErrors.length > 0 && (
            <div className="bg-[#F7F6F2] border border-rose-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
              <h3 className="text-sm font-bold text-rose-400 uppercase tracking-wider font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">report_problem</span>
                Relatório de Inconsistências Encaminhadas para Rejeição ({validationErrors.length})
              </h3>
              <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                {validationErrors.map((err, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-[#EAE8E2] border border-rose-500/20 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">Linha {err.rowNumber}</span>
                      <span className="text-[#171717] font-bold">Coluna: {err.column}</span>
                    </div>
                    <div className="text-[#77766F] text-xs">
                      Valor: <code className="text-amber-300 font-mono">{err.value || 'VAZIO'}</code> — <span className="text-rose-300">{err.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabela de Prévia dos Dados Aceitos */}
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400">table_chart</span>
                Prévia das Linhas Válidas ({acceptedRows.length})
              </h3>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#CFCDC5]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#E3E1DA] border-b border-[#CFCDC5] text-[11px] font-bold text-[#171717] uppercase tracking-wider font-mono">
                    {selectedType === 'rotas' ? (
                      <>
                        <th className="py-3 px-4">Rota</th>
                        <th className="py-3 px-4">Indústria</th>
                        <th className="py-3 px-4">Loja</th>
                        <th className="py-3 px-4">UF</th>
                        <th className="py-3 px-4">Promotor</th>
                        <th className="py-3 px-4">Frequência</th>
                        <th className="py-3 px-4">Dias marcados</th>
                      </>
                    ) : (
                      acceptedRows.length > 0 &&
                      Object.keys(acceptedRows[0]).map((key) => (
                        <th key={key} className="py-3 px-4">{key}</th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#CFCDC5] text-[#171717]">
                  {acceptedRows.slice(0, 10).map((row, idx) => {
                    if (selectedType === 'rotas') {
                      const days = [];
                      if (isDayMarked(row.segunda)) days.push('Seg');
                      if (isDayMarked(row.terca)) days.push('Ter');
                      if (isDayMarked(row.quarta)) days.push('Qua');
                      if (isDayMarked(row.quinta)) days.push('Qui');
                      if (isDayMarked(row.sexta)) days.push('Sex');
                      if (isDayMarked(row.sabado)) days.push('Sáb');
                      if (isDayMarked(row.domingo)) days.push('Dom');

                      const rotaCode = row.codigo_rota?.trim() || `ROT-${(row.promotor || row.promotor_matricula || 'GERAL').trim()}`;

                      return (
                        <tr key={idx} className="hover:bg-[#EAE8E1]">
                          <td className="py-3 px-4 font-mono font-bold text-purple-400">{rotaCode}</td>
                          <td className="py-3 px-4 font-mono">{row.industria || row.industria_codigo}</td>
                          <td className="py-3 px-4 font-mono">{row.loja || row.loja_codigo}</td>
                          <td className="py-3 px-4 font-mono">{row.uf || '-'}</td>
                          <td className="py-3 px-4 font-mono">{row.promotor || row.promotor_matricula}</td>
                          <td className="py-3 px-4 font-mono uppercase">{row.frequencia || 'SEMANAL'}</td>
                          <td className="py-3 px-4 font-mono text-emerald-400 font-bold">{days.join(', ') || 'Nenhum'}</td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={idx} className="hover:bg-[#EAE8E1]">
                        {Object.values(row).map((val, vIdx) => (
                          <td key={vIdx} className="py-3 px-4 font-mono">{val}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {acceptedRows.length > 10 && (
              <p className="text-[11px] text-[#5F5F5F] font-mono text-center">
                Exibindo as primeiras 10 de {acceptedRows.length} linhas válidas.
              </p>
            )}

            {/* Ações de Confirmação ou Cancelamento */}
            <div className="pt-4 border-t border-[#CFCDC5] flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setStep('upload');
                  setFile(null);
                }}
                className="px-5 py-2.5 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer"
              >
                Cancelar Importação
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={saving || acceptedRows.length === 0}
                className="px-6 py-2.5 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {saving ? (
                  <span>Gravando no Banco...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-base">check_circle</span>
                    <span>Confirmar &amp; Gravar {acceptedRows.length} Registros</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* VIEW: HISTÓRICO DE IMPORTAÇÕES */}
      {step === 'history' && (
        <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-400">history</span>
              Histórico Geral de Importações de Planilhas
            </h3>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[#CFCDC5]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#E3E1DA] border-b border-[#CFCDC5] text-[11px] font-bold text-[#171717] uppercase tracking-wider font-mono">
                  <th className="py-3.5 px-4">Data / Hora</th>
                  <th className="py-3.5 px-4">Arquivo</th>
                  <th className="py-3.5 px-4">Tipo</th>
                  <th className="py-3.5 px-4">Importado Por</th>
                  <th className="py-3.5 px-4">Linhas Total</th>
                  <th className="py-3.5 px-4">Aceitas</th>
                  <th className="py-3.5 px-4">Rejeitadas</th>
                  <th className="py-3.5 px-4">Modo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CFCDC5] text-[#171717]">
                {loadingHistory ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[#77766F] font-mono text-xs">
                      Carregando histórico de cargas...
                    </td>
                  </tr>
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[#77766F] font-mono text-xs">
                      Nenhuma importação registrada no histórico ainda.
                    </td>
                  </tr>
                ) : (
                  history.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[#EAE8E1] font-mono">
                      <td className="py-3.5 px-4 text-[#77766F]">
                        {new Date(rec.created_at).toLocaleString('pt-BR')}
                      </td>
                      <td className="py-3.5 px-4 text-white font-bold">{rec.filename}</td>
                      <td className="py-3.5 px-4 uppercase text-[#7E22CE] font-bold">{rec.tipo}</td>
                      <td className="py-3.5 px-4 text-[#171717]">{rec.imported_by_email}</td>
                      <td className="py-3.5 px-4 font-bold">{rec.rows_total}</td>
                      <td className="py-3.5 px-4 text-emerald-400 font-bold">{rec.rows_accepted}</td>
                      <td className="py-3.5 px-4 text-rose-400 font-bold">{rec.rows_rejected}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${rec.is_upsert ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-[#77766F]'}`}>
                          {rec.is_upsert ? 'UPSERT' : 'SEGURO'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
