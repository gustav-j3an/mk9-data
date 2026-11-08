DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'm38-expire-old-open-visits' LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'm38-expire-old-open-visits',
  '* * * * *',
  'SELECT attendance_private.expire_old_open_visits()'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'm38-expire-old-open-visits' AND schedule = '* * * * *') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one M38 daily-close cron job';
  END IF;
END;
$$;
