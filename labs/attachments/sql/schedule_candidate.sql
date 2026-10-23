-- REVIEW ONLY: not installed by app startup or any ordinary migration.
-- After separate approval, reuse Free pg_cron + pg_net + Vault. Do not embed
-- credentials in the cron command. Required Vault entries are provisioned by
-- the existing secret administrator, outside this candidate.
-- Keep ATTACHMENT_CLEANUP_ENABLED=false until the complete deployment review.
select cron.schedule('attachment-lifecycle-expiry', '*/5 * * * *', $job$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='attachment_lifecycle_url'),
   headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='attachment_lifecycle_scheduler_token'),'Content-Type','application/json'),
   body := '{"action":"sweep"}'::jsonb,
   timeout_milliseconds := 55000
 );
$job$);
