-- Read-only mapping and privacy/runtime readback. No credential or row payload.
BEGIN READ ONLY;
WITH expected(key) AS (VALUES ('CO-01'),('CO-02'),('CO-03'),('GEM-01'),('GH-HELPER'))
SELECT e.key,count(DISTINCT a.id),count(DISTINCT p.id),
 CASE WHEN count(DISTINCT a.id)=1 AND count(DISTINCT p.id)=1
 AND bool_and(a.runtime_id IS NULL AND a.runtime_mode='cloud' AND a.visibility='private' AND a.permission_mode='private' AND a.kind='user' AND a.status='offline' AND a.owner_id='ac5afcc7-f045-41a9-8827-eaf085a04c0d') THEN 'MAPPED_UNBOUND_PRIVATE' ELSE 'NOT_VERIFIED' END
FROM expected e LEFT JOIN taskflow.agent a ON a.workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND a.system_key=e.key AND a.archived_at IS NULL
LEFT JOIN taskflow.project p ON p.workspace_id=a.workspace_id AND p.lead_type='agent' AND p.lead_id=a.id
GROUP BY e.key ORDER BY e.key;
COMMIT;
