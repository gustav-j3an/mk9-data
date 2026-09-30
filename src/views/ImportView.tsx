import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
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

  // Leitura e Detecção Automática do Tipo de Planilha
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setParsing(true);

    try {
      const text = await uploadedFile.text();
      const { headers, rows } = parseCSV(text);

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
      if (headers.includes('codigo_rota') || headers.includes('promotor_matricula')) {
        detectedType = 'rotas';
      } else if (headers.includes('matricula') || headers.includes('supervisor')) {
        detectedType = 'promotores';
      } else if (headers.includes('endereco') || headers.includes('rede')) {
        detectedType = 'lojas';
      } else if (headers.includes('codigo') && headers.includes('observacao')) {
        detectedType = 'industrias';
      }

      setSelectedType(detectedType);
      setParsedRows(rows);
      validateData(rows, detectedType);
      setStep('preview');
    } catch (err) {
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
        if (!row.codigo_rota?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'codigo_rota', value: '', message: 'Campo obrigatório.' });
        if (!row.data?.trim() || !validateDate(row.data)) rowErrors.push({ rowNumber: rowNum, column: 'data', value: row.data || '', message: 'Data inválida (formato AAAA-MM-DD).' });
        if (!row.promotor_matricula?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'promotor_matricula', value: '', message: 'Campo obrigatório.' });
        if (!row.loja_codigo?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'loja_codigo', value: '', message: 'Campo obrigatório.' });
        if (!row.industria_codigo?.trim()) rowErrors.push({ rowNumber: rowNum, column: 'industria_codigo', value: '', message: 'Campo obrigatório.' });
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
        // Gravar Registros Aceitos na Tabela Destino
        if (allowUpsert) {
          const onConflictKey =
            selectedType === 'industrias' ? 'codigo' :
            selectedType === 'lojas' ? 'codigo' :
            selectedType === 'promotores' ? 'matricula' : 'codigo_rota,data,promotor_matricula,loja_codigo,industria_codigo';

          const { error: upsertErr } = await supabase
            .from(selectedType)
            .upsert(acceptedRows, { onConflict: onConflictKey });

          if (upsertErr) throw upsertErr;
        } else {
          const { error: insertErr } = await supabase
            .from(selectedType)
            .insert(acceptedRows);

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
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-8 font-sans">
      {/* Top Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2433] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(147,51,234,0.6)]">
              <span className="material-symbols-outlined text-[20px]">upload_file</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Importação de Dados por Planilha
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Carga em lote de <code className="text-purple-400 font-mono">Indústrias</code>, <code className="text-cyan-400 font-mono">Lojas</code>, <code className="text-emerald-400 font-mono">Promotores</code> e <code className="text-amber-400 font-mono">Rotas</code> com validação prévia de integridade.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep(step === 'history' ? 'upload' : 'history')}
            className="px-4 py-2 rounded-xl bg-[#171b26] border border-[#1e2433] text-xs font-semibold text-slate-300 hover:text-white hover:border-purple-500/40 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">
              {step === 'history' ? 'upload_file' : 'history'}
            </span>
            <span>{step === 'history' ? 'Nova Importação' : 'Histórico de Cargas'}</span>
          </button>
        </div>
      </section>

      {/* VIEW: UPLOAD */}
      {step === 'upload' && (
        <section className="space-y-6">
          {/* Configuração de Tipo & Download de Modelos */}
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-6">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-400">tune</span>
              1. Selecione o Tipo de Cadastro &amp; Baixe o Modelo Limpo
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(['industrias', 'lojas', 'promotores', 'rotas'] as ImportType[]).map((type) => {
                const spec = TEMPLATE_SPECS[type];
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                      selectedType === type
                        ? 'bg-purple-950/40 border-purple-500 text-white shadow-[0_0_15px_rgba(147,51,234,0.3)]'
                        : 'bg-[#131722] border-[#1e2433] text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm uppercase tracking-wider font-mono">{type}</span>
                      <span className="material-symbols-outlined text-xl">
                        {type === 'industrias' ? 'factory' : type === 'lojas' ? 'store' : type === 'promotores' ? 'badge' : 'alt_route'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      {type === 'industrias' && 'Marcas e indústrias parceiras.'}
                      {type === 'lojas' && 'PDVs, redes e endereços.'}
                      {type === 'promotores' && 'Matrículas e equipes.'}
                      {type === 'rotas' && 'Vínculos diários de visitas.'}
                    </p>

                    <div className="mt-4 pt-3 border-t border-[#1e2433] flex items-center justify-between gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadXLSX(type);
                        }}
                        className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] font-mono font-bold flex items-center gap-1 border border-emerald-500/40 transition-colors"
                        title="Baixar Modelo Completo XLSX com Abas e Filtros"
                      >
                        <span className="material-symbols-outlined text-[12px]">grid_on</span>
                        <span>XLSX</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadCSV(type);
                        }}
                        className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-[10px] font-mono font-bold flex items-center gap-1 border border-cyan-500/40 transition-colors"
                        title="Baixar Modelo CSV Limpo com Cabeçalho UTF-8"
                      >
                        <span className="material-symbols-outlined text-[12px]">csv</span>
                        <span>CSV Limpo</span>
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Painel de Instruções e Orientações do Tipo Selecionado */}
            <div className="p-5 rounded-xl bg-[#131722] border border-[#1e2433] space-y-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400 text-lg">info</span>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Instruções &amp; Relacionamentos: {currentSpec.title}
                </h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
                <div>
                  <span className="font-bold text-slate-400 font-mono block">FINALIDADE:</span>
                  <p className="mt-0.5 text-slate-300">{currentSpec.instructions.finalidade}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-400 font-mono block">CAMPOS OBRIGATÓRIOS:</span>
                  <p className="mt-0.5 text-amber-300 font-mono">{currentSpec.instructions.obrigatorios}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-400 font-mono block">ORDEM DE IMPORTAÇÃO:</span>
                  <p className="mt-0.5 text-purple-300 font-mono">{currentSpec.instructions.ordem}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-400 font-mono block">DEPENDÊNCIAS &amp; RELACIONAMENTOS:</span>
                  <p className="mt-0.5 text-cyan-300 font-mono">{currentSpec.instructions.relacionamentos}</p>
                </div>
              </div>
            </div>

            {/* Configuração de Preservação vs Upsert */}
            <div className="pt-4 border-t border-[#1e2433] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-bold text-slate-200">Modo de Gravação de Dados</span>
                <p className="text-xs text-slate-400">
                  Por padrão, os dados existentes são <strong>preservados</strong>. Marque para atualizar registros com chaves duplicadas (Upsert).
                </p>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer bg-[#131722] border border-[#1e2433] px-4 py-2.5 rounded-xl">
                <input
                  type="checkbox"
                  checked={allowUpsert}
                  onChange={(e) => setAllowUpsert(e.target.checked)}
                  className="rounded border-[#1e2433] bg-[#171b26] text-purple-600 focus:ring-purple-500 w-4 h-4"
                />
                <span className="text-xs font-mono font-bold text-slate-200">
                  {allowUpsert ? 'Modo Upsert (Atualizar Duplicados)' : 'Modo Seguro (Manter Existentes)'}
                </span>
              </label>
            </div>
          </div>

          {/* Área de Dropzone / Upload */}
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-10 shadow-2xl text-center relative overflow-hidden">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
            />
            <div className="max-w-md mx-auto space-y-4 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-[#131722] border border-[#1e2433] flex items-center justify-center text-purple-400 shadow-inner">
                <span className="material-symbols-outlined text-4xl">cloud_upload</span>
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">Arraste ou selecione a planilha preenchida (CSV ou XLSX)</h3>
                <p className="text-xs text-slate-400">
                  Suporta arquivos formatados para <strong>{selectedType.toUpperCase()}</strong>.
                </p>
              </div>
              <button className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs neon-purple-glow transition-all">
                Selecionar Arquivo Preenchido
              </button>
            </div>
          </div>
        </section>
      )}

      {/* VIEW: PRÉVIA E VALIDAÇÃO */}
      {step === 'preview' && (
        <section className="space-y-6">
          {/* Card Resumo de Validação */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="p-5 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
              <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
                <span>TOTAL DE LINHAS LIDAS</span>
                <span className="material-symbols-outlined text-purple-400">format_list_numbered</span>
              </div>
              <div className="text-3xl font-extrabold text-white font-mono mt-2">{parsedRows.length}</div>
            </div>

            <div className="p-5 rounded-2xl bg-[#171b26] border border-emerald-500/30 shadow-xl">
              <div className="flex items-center justify-between text-emerald-400 font-mono text-xs font-bold">
                <span>ACEITAS PARA IMPORTAÇÃO</span>
                <span className="material-symbols-outlined">check_circle</span>
              </div>
              <div className="text-3xl font-extrabold text-emerald-400 font-mono mt-2">{acceptedRows.length}</div>
            </div>

            <div className="p-5 rounded-2xl bg-[#171b26] border border-rose-500/30 shadow-xl">
              <div className="flex items-center justify-between text-rose-400 font-mono text-xs font-bold">
                <span>REJEITADAS COM ERRO</span>
                <span className="material-symbols-outlined">warning</span>
              </div>
              <div className="text-3xl font-extrabold text-rose-400 font-mono mt-2">{rejectedRows.length}</div>
            </div>
          </div>

          {/* Relatório de Erros por Linha e Coluna */}
          {validationErrors.length > 0 && (
            <div className="bg-[#171b26] border border-rose-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
              <h3 className="text-sm font-bold text-rose-400 uppercase tracking-wider font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">report_problem</span>
                Relatório de Inconsistências Encaminhadas para Rejeição ({validationErrors.length})
              </h3>
              <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                {validationErrors.map((err, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-[#131722] border border-rose-500/20 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">Linha {err.rowNumber}</span>
                      <span className="text-slate-300 font-bold">Coluna: {err.column}</span>
                    </div>
                    <div className="text-slate-400 text-xs">
                      Valor: <code className="text-amber-300 font-mono">{err.value || 'VAZIO'}</code> — <span className="text-rose-300">{err.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabela de Prévia dos Dados Aceitos */}
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400">table_chart</span>
                Prévia das Linhas Válidas ({acceptedRows.length})
              </h3>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                    {acceptedRows.length > 0 &&
                      Object.keys(acceptedRows[0]).map((key) => (
                        <th key={key} className="py-3 px-4">{key}</th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433] text-slate-300">
                  {acceptedRows.slice(0, 10).map((row, idx) => (
                    <tr key={idx} className="hover:bg-[#131722]/60">
                      {Object.values(row).map((val, vIdx) => (
                        <td key={vIdx} className="py-3 px-4 font-mono">{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {acceptedRows.length > 10 && (
              <p className="text-[11px] text-slate-500 font-mono text-center">
                Exibindo as primeiras 10 de {acceptedRows.length} linhas válidas.
              </p>
            )}

            {/* Ações de Confirmação ou Cancelamento */}
            <div className="pt-4 border-t border-[#1e2433] flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setStep('upload');
                  setFile(null);
                }}
                className="px-5 py-2.5 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold cursor-pointer"
              >
                Cancelar Importação
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={saving || acceptedRows.length === 0}
                className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs neon-purple-glow disabled:opacity-50 flex items-center gap-2 cursor-pointer"
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
        <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-400">history</span>
              Histórico Geral de Importações de Planilhas
            </h3>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
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
              <tbody className="divide-y divide-[#1e2433] text-slate-300">
                {loadingHistory ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-mono text-xs">
                      Carregando histórico de cargas...
                    </td>
                  </tr>
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-mono text-xs">
                      Nenhuma importação registrada no histórico ainda.
                    </td>
                  </tr>
                ) : (
                  history.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[#131722]/60 font-mono">
                      <td className="py-3.5 px-4 text-slate-400">
                        {new Date(rec.created_at).toLocaleString('pt-BR')}
                      </td>
                      <td className="py-3.5 px-4 text-white font-bold">{rec.filename}</td>
                      <td className="py-3.5 px-4 uppercase text-purple-300 font-bold">{rec.tipo}</td>
                      <td className="py-3.5 px-4 text-slate-300">{rec.imported_by_email}</td>
                      <td className="py-3.5 px-4 font-bold">{rec.rows_total}</td>
                      <td className="py-3.5 px-4 text-emerald-400 font-bold">{rec.rows_accepted}</td>
                      <td className="py-3.5 px-4 text-rose-400 font-bold">{rec.rows_rejected}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${rec.is_upsert ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>
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
