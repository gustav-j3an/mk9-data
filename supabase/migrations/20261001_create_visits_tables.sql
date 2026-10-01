-- ==============================================================================
-- MK9 COMMAND CENTER - MIGRAÇÃO PARA PORTAL DO PROMOTOR E REGISTRO DE VISITAS
-- ==============================================================================

-- 1. Atualizar constraint do campo role na tabela public.profiles para incluir 'promotor'
DO $$
BEGIN
  -- Remover constraint existente de role se houver
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  -- Adicionar nova constraint com role 'promotor'
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'gestor', 'operador', 'promotor'));
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 2. Adicionar vínculo na tabela public.profiles com public.promotores (matricula)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='promotor_matricula') THEN
    ALTER TABLE public.profiles ADD COLUMN promotor_matricula TEXT REFERENCES public.promotores(matricula) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Tabela de Visitas (visits)
CREATE TABLE IF NOT EXISTS public.visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_id UUID REFERENCES public.rotas(id) ON DELETE SET NULL ON UPDATE CASCADE,
  promotor_matricula TEXT NOT NULL REFERENCES public.promotores(matricula) ON DELETE CASCADE ON UPDATE CASCADE,
  loja_codigo TEXT NOT NULL REFERENCES public.lojas(codigo) ON DELETE CASCADE ON UPDATE CASCADE,
  industria_codigo TEXT NOT NULL REFERENCES public.industrias(codigo) ON DELETE CASCADE ON UPDATE CASCADE,
  data_visita DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluida', 'nao_realizada')),
  motivo_nao_realizada TEXT,
  observacao_geral TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela de Itens de Checklist da Visita (visit_checklist_items)
CREATE TABLE IF NOT EXISTS public.visit_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  checked BOOLEAN DEFAULT FALSE,
  valor_texto TEXT,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabela de Fotos da Visita (visit_photos)
CREATE TABLE IF NOT EXISTS public.visit_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  tipo_foto TEXT NOT NULL CHECK (tipo_foto IN ('fachada', 'gondola', 'preco', 'ponto_extra', 'ruptura', 'outros')),
  storage_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  legenda TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabela de Ocorrências e Rupturas (visit_occurrences)
CREATE TABLE IF NOT EXISTS public.visit_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('ruptura', 'preco_divergente', 'falta_espaco', 'outro')),
  descricao TEXT NOT NULL,
  resolvido BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS nas novas tabelas
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_occurrences ENABLE ROW LEVEL SECURITY;

-- Politicas RLS para visits:
-- Admin e gestor podem ver e gerenciar tudo
-- Promotor só pode ver e criar/atualizar suas próprias visitas
CREATE POLICY "Visitas acessiveis por admin e gestor" ON public.visits FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'gestor')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'gestor')
  )
);

CREATE POLICY "Promotor acessa apenas suas visitas" ON public.visits FOR ALL TO authenticated USING (
  promotor_matricula IN (
    SELECT promotor_matricula FROM public.profiles WHERE id = auth.uid()
  )
) WITH CHECK (
  promotor_matricula IN (
    SELECT promotor_matricula FROM public.profiles WHERE id = auth.uid()
  )
);

-- Politicas RLS para visit_checklist_items
CREATE POLICY "Checklist acessivel por gestores e promotor dono" ON public.visit_checklist_items FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.visits v
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE v.id = visit_checklist_items.visit_id
    AND (p.role IN ('admin', 'gestor') OR v.promotor_matricula = p.promotor_matricula)
  )
);

-- Politicas RLS para visit_photos
CREATE POLICY "Fotos acessiveis por gestores e promotor dono" ON public.visit_photos FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.visits v
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE v.id = visit_photos.visit_id
    AND (p.role IN ('admin', 'gestor') OR v.promotor_matricula = p.promotor_matricula)
  )
);

-- Politicas RLS para visit_occurrences
CREATE POLICY "Ocorrencias acessiveis por gestores e promotor dono" ON public.visit_occurrences FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.visits v
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE v.id = visit_occurrences.visit_id
    AND (p.role IN ('admin', 'gestor') OR v.promotor_matricula = p.promotor_matricula)
  )
);

-- 7. Configuração do Bucket Privado de Fotos da Visita no Supabase Storage
INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-photos', 'visit-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Politica RLS de Upload e Leitura no Bucket Privado
CREATE POLICY "Leitura de fotos do bucket por gestores e promotor" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'visit-photos'
);

CREATE POLICY "Upload de fotos no bucket por usuarios autenticados" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'visit-photos'
);
