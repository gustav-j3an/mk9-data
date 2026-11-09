DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('m38-expire-old-open-visits', 'mk9-cloud-cron-smoke')
  LOOP
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

-- Commit the smoke job registration before waiting so the cron launcher can see it.
SELECT cron.schedule('mk9-cloud-cron-smoke', '* * * * *', 'SELECT 1');

DO $$
DECLARE
  v_job_id bigint;
  v_deadline timestamptz := clock_timestamp() + interval '90 seconds';
BEGIN
  SELECT jobid INTO STRICT v_job_id
  FROM cron.job WHERE jobname = 'mk9-cloud-cron-smoke';

  LOOP
    IF EXISTS (
      SELECT 1 FROM cron.job_run_details
      WHERE jobid = v_job_id AND status = 'succeeded'
    ) THEN
      EXIT;
    END IF;
    IF clock_timestamp() >= v_deadline THEN
      RAISE EXCEPTION 'pg_cron smoke job did not succeed within 90 seconds (job id %)', v_job_id;
    END IF;
    PERFORM pg_sleep(1);
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO STRICT v_job_id
  FROM cron.job WHERE jobname = 'mk9-cloud-cron-smoke';
  PERFORM cron.unschedule(v_job_id);
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = v_job_id) THEN
    RAISE EXCEPTION 'pg_cron smoke job cleanup failed (job id %)', v_job_id;
  END IF;
  RAISE NOTICE 'pg_cron smoke job executed successfully and was removed.';
END;
$$;
