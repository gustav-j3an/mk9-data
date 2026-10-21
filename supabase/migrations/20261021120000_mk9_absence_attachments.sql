-- Prepared only. Apply and validate only in an authorized isolated environment.
-- Sensitive absence evidence lives in a private Storage bucket, never in public URLs.
BEGIN;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('absence-documents', 'absence-documents', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id='absence-documents' AND public=false AND file_size_limit=10485760
      AND allowed_mime_types @> ARRAY['application/pdf','image/jpeg','image/png']::text[]
  ) THEN
    RAISE EXCEPTION 'absence-documents bucket exists with an unexpected or public configuration';
  END IF;
END $$;

CREATE TABLE public.mk9_absence_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.mk9_absence_records(id) ON DELETE RESTRICT,
  object_path text NOT NULL UNIQUE,
  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 180 AND position('/' in original_name)=0 AND position(chr(92) in original_name)=0 AND original_name !~ '[[:cntrl:]]'),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  criado_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (object_path ~ ('^' || record_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png)$'))
);
CREATE INDEX mk9_absence_attachments_record ON public.mk9_absence_attachments(record_id, criado_em);
ALTER TABLE public.mk9_absence_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mk9_absence_attachments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.mk9_absence_attachments FROM PUBLIC, anon, authenticated;
CREATE POLICY mk9_absence_attachments_deny_direct ON public.mk9_absence_attachments AS RESTRICTIVE
  FOR ALL TO authenticated USING(false) WITH CHECK(false);

CREATE FUNCTION mk9_rh_private.can_read_absence_attachment(p_record_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT auth.uid() IS NOT NULL AND mk9_rh_private.can_prepare_absences() AND EXISTS (
    SELECT 1 FROM public.mk9_absence_records r
    JOIN public.mk9_alocacoes a ON a.id=r.alocacao_id
    JOIN public.mk9_identidades i ON i.promotor_id=a.promotor_id
    WHERE r.id=p_record_id AND i.estado='aprovado' AND a.estado='aprovado'
      AND a.valido_desde<=statement_timestamp() AND (a.valido_ate IS NULL OR statement_timestamp()<a.valido_ate)
      AND (
        (i.usuario_id=auth.uid()) OR r.responsavel_id=auth.uid() OR EXISTS (
          SELECT 1 FROM public.mk9_acessos g WHERE g.alocacao_id=a.id AND g.usuario_id=auth.uid()
            AND g.tipo IN ('supervisao','gestao') AND g.estado='aprovado' AND g.aprovado_por IS NOT NULL
            AND g.valido_desde<=statement_timestamp() AND (g.valido_ate IS NULL OR statement_timestamp()<g.valido_ate)
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.can_read_absence_attachment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mk9_rh_private.can_read_absence_attachment(uuid) TO authenticated;

CREATE FUNCTION mk9_rh_private.can_manage_absence_attachment(p_record_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT auth.uid() IS NOT NULL AND mk9_rh_private.can_prepare_absences() AND EXISTS (
    SELECT 1 FROM public.mk9_absence_records r
    WHERE r.id=p_record_id AND r.responsavel_id=auth.uid() AND r.status='rascunho'
  );
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.can_manage_absence_attachment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mk9_rh_private.can_manage_absence_attachment(uuid) TO authenticated;

CREATE FUNCTION mk9_rh_private.storage_absence_record_id(p_object_path text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $$
DECLARE parsed uuid;
BEGIN
  IF p_object_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png)$' THEN RETURN NULL; END IF;
  parsed := split_part(p_object_path,'/',1)::uuid;
  RETURN parsed;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.storage_absence_record_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mk9_rh_private.storage_absence_record_id(text) TO authenticated;

CREATE FUNCTION public.mk9_faltas_atestados_register_attachment(
  p_record_id uuid, p_object_path text, p_original_name text, p_mime_type text, p_size_bytes bigint
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT mk9_rh_private.can_manage_absence_attachment(p_record_id) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501';
  END IF;
  IF p_object_path IS NULL OR mk9_rh_private.storage_absence_record_id(p_object_path) IS DISTINCT FROM p_record_id
    OR p_original_name IS NULL OR length(p_original_name) NOT BETWEEN 1 AND 180
    OR position('/' in p_original_name)>0 OR position(chr(92) in p_original_name)>0 OR p_original_name ~ '[[:cntrl:]]'
    OR p_mime_type NOT IN ('application/pdf','image/jpeg','image/png')
    OR p_size_bytes NOT BETWEEN 1 AND 10485760 THEN
    RAISE EXCEPTION 'Invalid attachment metadata' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id='absence-documents' AND o.name=p_object_path
      AND o.metadata->>'mimetype'=p_mime_type
      AND (o.metadata->>'size')::bigint=p_size_bytes
  ) THEN RAISE EXCEPTION 'Uploaded object not found or metadata mismatch' USING ERRCODE='22023'; END IF;
  INSERT INTO public.mk9_absence_attachments(record_id,object_path,original_name,mime_type,size_bytes,uploaded_by)
    VALUES(p_record_id,p_object_path,p_original_name,p_mime_type,p_size_bytes,auth.uid()) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_register_attachment(uuid,text,text,text,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_register_attachment(uuid,text,text,text,bigint) TO authenticated;

CREATE FUNCTION public.mk9_faltas_atestados_list_attachments(p_record_id uuid)
RETURNS TABLE(id uuid, original_name text, mime_type text, size_bytes bigint, criado_em timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT mk9_rh_private.can_read_absence_attachment(p_record_id) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT a.id,a.original_name,a.mime_type,a.size_bytes,a.criado_em
    FROM public.mk9_absence_attachments a WHERE a.record_id=p_record_id ORDER BY a.criado_em;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_list_attachments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_list_attachments(uuid) TO authenticated;

CREATE FUNCTION public.mk9_faltas_atestados_attachment_path(p_attachment_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE result text;
BEGIN
  SELECT a.object_path INTO result FROM public.mk9_absence_attachments a
  WHERE a.id=p_attachment_id AND mk9_rh_private.can_read_absence_attachment(a.record_id);
  IF result IS NULL THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_attachment_path(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_attachment_path(uuid) TO authenticated;

CREATE FUNCTION public.mk9_faltas_atestados_delete_attachment(p_attachment_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE result text;
BEGIN
  DELETE FROM public.mk9_absence_attachments a
    WHERE a.id=p_attachment_id AND mk9_rh_private.can_manage_absence_attachment(a.record_id)
    RETURNING a.object_path INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_delete_attachment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_delete_attachment(uuid) TO authenticated;

-- Restrictive guards neutralize any broad permissive Storage policy for this bucket.
CREATE POLICY mk9_absence_storage_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO PUBLIC
  USING (bucket_id<>'absence-documents' OR (auth.uid() IS NOT NULL AND mk9_rh_private.can_read_absence_attachment(mk9_rh_private.storage_absence_record_id(name))));
CREATE POLICY mk9_absence_storage_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO PUBLIC
  WITH CHECK (bucket_id<>'absence-documents' OR (auth.uid() IS NOT NULL AND mk9_rh_private.can_manage_absence_attachment(mk9_rh_private.storage_absence_record_id(name))));
CREATE POLICY mk9_absence_storage_update_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
  USING (bucket_id<>'absence-documents' OR (auth.uid() IS NOT NULL AND mk9_rh_private.can_manage_absence_attachment(mk9_rh_private.storage_absence_record_id(name))))
  WITH CHECK (bucket_id<>'absence-documents' OR (auth.uid() IS NOT NULL AND mk9_rh_private.can_manage_absence_attachment(mk9_rh_private.storage_absence_record_id(name))));
CREATE POLICY mk9_absence_storage_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO PUBLIC
  USING (bucket_id<>'absence-documents' OR (auth.uid() IS NOT NULL AND mk9_rh_private.can_manage_absence_attachment(mk9_rh_private.storage_absence_record_id(name))));
CREATE POLICY mk9_absence_storage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='absence-documents' AND mk9_rh_private.can_read_absence_attachment(mk9_rh_private.storage_absence_record_id(name)));
CREATE POLICY mk9_absence_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='absence-documents' AND mk9_rh_private.can_manage_absence_attachment(mk9_rh_private.storage_absence_record_id(name)));
CREATE POLICY mk9_absence_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='absence-documents' AND mk9_rh_private.can_manage_absence_attachment(mk9_rh_private.storage_absence_record_id(name)));

COMMIT;
