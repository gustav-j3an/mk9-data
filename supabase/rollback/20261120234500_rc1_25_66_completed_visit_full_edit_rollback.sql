-- RC1.25.66 rollback: disables the edit workflow but preserves business data,
-- existing audit rows, and all Storage objects (including added evidence).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.save_completed_visit_full_edit(uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.begin_completed_visit_edit(uuid);

CREATE OR REPLACE FUNCTION attendance_private.photo_upload_allowed(object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.visits v JOIN public.profiles p ON p.id = auth.uid()
    WHERE p.status = 'ativo'
      AND object_name ~ '^visits/[0-9a-fA-F-]{36}/[^/]+$'
      AND split_part(object_name, '/', 2) = v.id::text
      AND (
        (p.role = 'promotor' AND p.promotor_matricula = v.promotor_matricula
          AND v.status = 'em_andamento' AND v.regularization_status IS NULL
          AND attendance_private.is_visit_in_current_operational_day(v.id))
        OR (p.role IN ('admin', 'gestor') AND attendance_private.staff_can_access(v.promotor_matricula))
      )
  );
$$;
REVOKE ALL ON FUNCTION attendance_private.photo_upload_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.photo_upload_allowed(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_visit_sku_stock_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_visit public.visits%ROWTYPE;
BEGIN
  SELECT * INTO v_visit FROM public.visits WHERE id = NEW.visit_id FOR UPDATE;
  IF NOT FOUND OR v_visit.status <> 'em_andamento'
     OR NEW.industria_codigo <> v_visit.industria_codigo
     OR NEW.loja_codigo <> v_visit.loja_codigo
     OR NEW.conferido_por_matricula <> v_visit.promotor_matricula THEN
    RAISE EXCEPTION 'Conferência SKU deve pertencer à visita aberta e ao promotor titular' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.industria_skus s
    WHERE s.industria_codigo = NEW.industria_codigo
      AND s.codigo_sku = NEW.codigo_sku AND s.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'SKU não está ativo no catálogo desta indústria' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_visit_sku_stock_check() FROM PUBLIC, anon, authenticated;

DROP TABLE IF EXISTS attendance_private.completed_visit_edit_authorizations;
COMMIT;
