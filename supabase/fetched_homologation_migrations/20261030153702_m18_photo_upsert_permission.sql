BEGIN;
-- Storage upsert needs SELECT + INSERT + UPDATE. Keep the existing restrictive
-- guards and require the same scoped authorization for old and new object paths.
CREATE POLICY m18_authorized_photo_upsert ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id='visit-photos' AND attendance_private.photo_upload_allowed(name))
WITH CHECK (bucket_id='visit-photos' AND attendance_private.photo_upload_allowed(name));
COMMIT;;
