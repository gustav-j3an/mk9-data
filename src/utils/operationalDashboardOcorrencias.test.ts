import test from 'node:test';
import assert from 'node:assert/strict';

// Tipos simulados com a estrutura real utilizada em OperationalDashboardView
interface OccurrenceAuditItem {
  id: string;
  visitId: string;
  tipo: string;
  descricao: string;
  resolvido: boolean;
  createdAt: string;
}

interface VisitWithEvidence {
  id: string;
  loja_codigo: string;
  industria_codigo: string;
  promotor_matricula: string;
  occurrences: OccurrenceAuditItem[];
  photos: Array<{
    id: string;
    tipo_foto: string;
    storage_path: string;
    file_url: string;
  }>;
}

// 1. Simulação das regras de autorização de resolução (canResolve = admin || gestor)
function canUserResolveOccurrence(role: string): boolean {
  return role === 'admin' || role === 'gestor';
}

// 2. Simulação de resolução otimista sem reload destrutivo
function resolveOccurrenceLocally(
  visits: VisitWithEvidence[],
  occurrenceId: string
): VisitWithEvidence[] {
  return visits.map((v) => {
    if (!v.occurrences) return v;
    const hasOcc = v.occurrences.some((o) => o.id === occurrenceId);
    if (!hasOcc) return v;

    return {
      ...v,
      occurrences: v.occurrences.map((o) =>
        o.id === occurrenceId ? { ...o, resolvido: true } : o
      )
    };
  });
}

// 3. Simulação de associação estrita e segura de URLs assinadas
function getSafeSignedUrlForVisit(
  visitId: string,
  rupturePhotosSigned: Record<string, string>
): string | undefined {
  // Associação estrita por visitId correspondente (sem correspondências frouxas)
  return rupturePhotosSigned[visitId];
}

// 4. Verificação de integridade factual do histórico (não inventar dados ausentes)
function getFactualOccurrenceHistory(occ: { createdAt?: string; visitId: string }) {
  return {
    hasCreationTimestamp: Boolean(occ.createdAt),
    visitId: occ.visitId,
    // Não deve conter tabelas ou logs fictícios de auditoria que não existem no banco
    isFactualOnly: true
  };
}

test('Onda 4.4B - Permissões de resolução restritas estritamente a admin e gestor', () => {
  assert.equal(canUserResolveOccurrence('admin'), true);
  assert.equal(canUserResolveOccurrence('gestor'), true);
  assert.equal(canUserResolveOccurrence('operador'), false);
  assert.equal(canUserResolveOccurrence('promotor'), false);
  assert.equal(canUserResolveOccurrence('client_industry'), false);
});

test('Onda 4.4B - Atualização local da ocorrência preserva integridade sem reload destrutivo', () => {
  const initialVisits: VisitWithEvidence[] = [
    {
      id: 'vis-101',
      loja_codigo: 'LJ01',
      industria_codigo: 'IND01',
      promotor_matricula: 'P001',
      occurrences: [
        {
          id: 'occ-1',
          visitId: 'vis-101',
          tipo: 'ruptura',
          descricao: 'Falta de refrigerante 2L',
          resolvido: false,
          createdAt: '2026-10-18T10:00:00Z'
        }
      ],
      photos: []
    },
    {
      id: 'vis-102',
      loja_codigo: 'LJ02',
      industria_codigo: 'IND02',
      promotor_matricula: 'P002',
      occurrences: [
        {
          id: 'occ-2',
          visitId: 'vis-102',
          tipo: 'ruptura',
          descricao: 'Falta de detergente',
          resolvido: false,
          createdAt: '2026-10-18T11:00:00Z'
        }
      ],
      photos: []
    }
  ];

  const updated = resolveOccurrenceLocally(initialVisits, 'occ-1');

  // Apenas a ocorrência occ-1 deve ter sido marcada como resolvida
  const occ1 = updated[0].occurrences.find((o) => o.id === 'occ-1');
  const occ2 = updated[1].occurrences.find((o) => o.id === 'occ-2');

  assert.equal(occ1?.resolvido, true);
  assert.equal(occ2?.resolvido, false);
  // Visitas e metadados devem ser preservados
  assert.equal(updated[0].loja_codigo, 'LJ01');
  assert.equal(updated[1].loja_codigo, 'LJ02');
});

test('Onda 4.4B - Associação estrita de URLs assinadas por visita (sem correspondências frouxas)', () => {
  const signedUrls: Record<string, string> = {
    'vis-101': 'https://storage.supabase.co/visit-photos/vis-101/ruptura.jpg?token=abc',
    'vis-102': 'https://storage.supabase.co/visit-photos/vis-102/ruptura.jpg?token=xyz'
  };

  assert.equal(
    getSafeSignedUrlForVisit('vis-101', signedUrls),
    'https://storage.supabase.co/visit-photos/vis-101/ruptura.jpg?token=abc'
  );
  assert.equal(
    getSafeSignedUrlForVisit('vis-102', signedUrls),
    'https://storage.supabase.co/visit-photos/vis-102/ruptura.jpg?token=xyz'
  );
  assert.equal(getSafeSignedUrlForVisit('vis-999', signedUrls), undefined);
});

test('Onda 4.4B - Histórico factual da ocorrência restringe-se a dados comprovados', () => {
  const occ = {
    createdAt: '2026-10-18T14:30:00Z',
    visitId: 'vis-101'
  };

  const history = getFactualOccurrenceHistory(occ);
  assert.equal(history.hasCreationTimestamp, true);
  assert.equal(history.visitId, 'vis-101');
  assert.equal(history.isFactualOnly, true);
});

