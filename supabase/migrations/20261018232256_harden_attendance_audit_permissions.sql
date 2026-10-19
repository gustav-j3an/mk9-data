-- Apply after the two attendance proposals. No data reset or default shifts.
BEGIN;

-- A permissive self-insert policy must not allow a caller to choose an admin role.
CREATE POLICY profiles_safe_insert ON public.profiles AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin' AND status = 'ativo') OR (
    id = (SELECT auth.uid()) AND role = 'operador' AND status = 'ativo'
    AND promotor_matricula IS NULL AND industria_codigo IS NULL
  )
);

-- Self-profile UPDATE must not let a user impersonate a different promoter/industry.
-- Keep ordinary name/avatar edits and trusted backend provisioning intact.
CREATE FUNCTION public.guard_profile_operational_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;
  IF (NEW.role, NEW.status, NEW.promotor_matricula, NEW.industria_codigo)
     IS DISTINCT FROM (OLD.role, OLD.status, OLD.promotor_matricula, OLD.industria_codigo)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND status = 'ativo'
     ) THEN
    RAISE EXCEPTION 'Only active administrators can change operational identity' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_profile_operational_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_operational_identity BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_operational_identity();

-- All attendance reads/writes require an active operational profile.
CREATE POLICY attendance_active_reader ON public.promoter_attendance_records AS RESTRICTIVE
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid())
  AND status = 'ativo' AND role IN ('admin', 'gestor', 'operador')
));
CREATE POLICY attendance_active_auditor ON public.promoter_attendance_audit_log AS RESTRICTIVE
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid())
  AND status = 'ativo' AND role IN ('admin', 'gestor')
));
CREATE POLICY attendance_active_absence_user ON public.promoter_absences AS RESTRICTIVE
FOR ALL TO authenticated USING (EXISTS (
  SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND status = 'ativo'
)) WITH CHECK (EXISTS (
  SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND status = 'ativo'
));
CREATE POLICY attendance_active_schedule_user ON public.promoter_work_schedules AS RESTRICTIVE
FOR ALL TO authenticated USING (EXISTS (
  SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND status = 'ativo'
)) WITH CHECK (EXISTS (
  SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND status = 'ativo'
));

-- Direct client writes are denied even if default privileges grant ALL.
REVOKE ALL ON public.promoter_attendance_records, public.promoter_attendance_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.promoter_attendance_records, public.promoter_attendance_audit_log TO authenticated;
ALTER FUNCTION public.is_promoter_on_absence(TEXT, DATE) SECURITY INVOKER;
ALTER FUNCTION public.get_promoter_schedule(TEXT, TEXT) SECURITY INVOKER;

COMMIT;
