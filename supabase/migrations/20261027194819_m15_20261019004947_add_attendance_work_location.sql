BEGIN;
ALTER TABLE public.promoter_work_schedules ADD COLUMN work_uf text,ADD COLUMN work_city text,
 ADD CONSTRAINT journey_work_location CHECK((work_uf IS NULL OR work_uf ~ '^[A-Z]{2}$') AND (work_city IS NULL OR work_uf IS NOT NULL));
ALTER TABLE public.promoter_work_schedule_templates ADD COLUMN work_uf text,ADD COLUMN work_city text,
 ADD CONSTRAINT template_work_location CHECK((work_uf IS NULL OR work_uf ~ '^[A-Z]{2}$') AND (work_city IS NULL OR work_uf IS NOT NULL));
ALTER FUNCTION public.set_promoter_work_schedule(text,text,time,time,date,integer,integer,text,text,text,boolean) SET SCHEMA attendance_private;
REVOKE ALL ON FUNCTION attendance_private.set_promoter_work_schedule(text,text,time,time,date,integer,integer,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.set_promoter_work_schedule(p_matricula text,p_day text,p_start time,p_end time,p_from date,p_interval integer,p_tolerance integer,p_timezone text,p_modalidade text,p_reason text,p_exception boolean DEFAULT false,p_work_uf text DEFAULT NULL,p_work_city text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid;
BEGIN
 result:=attendance_private.set_promoter_work_schedule(p_matricula,p_day,p_start,p_end,p_from,p_interval,p_tolerance,p_timezone,p_modalidade,p_reason,p_exception);
 UPDATE promoter_work_schedules SET work_uf=NULLIF(upper(trim(p_work_uf)),''),work_city=NULLIF(trim(p_work_city),'') WHERE id=result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.set_promoter_work_schedule(text,text,time,time,date,integer,integer,text,text,text,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_promoter_work_schedule(text,text,time,time,date,integer,integer,text,text,text,boolean,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
