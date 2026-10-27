"""Workflow-only contract checks. No production connection or side effects."""
import ast,hashlib,importlib.util,os,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
class G1WorkflowContract(unittest.TestCase):
 def test_workflow_pins_manual_gate_and_never_step1_apply(self):
  text=(ROOT/'.github/workflows/taskflow-g1-executor-mapping.yml').read_text()
  for marker in ["workflow_dispatch:",'production-migration','cancel-in-progress: false','GITHUB_SHA','persist-credentials: false','readonly-reconcile','coordination_window','always()','g1-workflow-operation.py']:
   self.assertIn(marker,text)
  self.assertNotIn('taskflow_native_dispatch_authority_candidate.sql',text)
  self.assertNotIn('rollback-guarded',text)
  for key,p in [('CANDIDATE','sql/taskflow_executor_mapping_candidate.sql'),('POSTFLIGHT','sql/taskflow_executor_mapping_postflight.sql'),('RUNNER','scripts/run-g1-reviewed-sql.py'),('OPERATION','scripts/g1-workflow-operation.py'),('GUARD','sql/taskflow_migration_role_guard.sql'),('CA','certs/supabase-prod-ca-2021.crt')]:
   self.assertIn('PIN_'+key+'_SHA256: '+hashlib.sha256((ROOT/'labs/taskflow'/p).read_bytes()).hexdigest(),text)
 def test_adapter_is_syntax_valid_and_no_delete_restore_or_retry(self):
  source=(ROOT/'labs/taskflow/scripts/g1-workflow-operation.py').read_text();ast.parse(source)
  self.assertNotIn('DELETE FROM',source);self.assertNotIn('DROP TABLE',source);self.assertNotIn('CREATE TABLE',source)
  for marker in ['G1_STOPPED_COMMIT_UNKNOWN_READONLY_RECONCILE_REQUIRED','G1_STOPPED_POSTFLIGHT_FAILED_RETAIN','G1_READONLY_COMMITTED_EXACT','G1_BACKUP_COMMIT_STATE_UNRESOLVED_READONLY_BACKUP_RECONCILE_REQUIRED_NO_MAPPING_ATTEMPT','service=os.environ','c.set_session(readonly=readonly)','owner_only(q','gzip.decompress(base64.b64decode','c.commit()']:
   self.assertIn(marker,source)
 def test_ledger_absence_and_backup_ack_fail_closed(self):
  source=(ROOT/'labs/taskflow/scripts/g1-workflow-operation.py').read_text()
  self.assertIn('G1_LEDGER_ABSENT_UNRESOLVED_NATIVE_IDS_NOT_PROVEN',source)
  self.assertNotIn('G1_READONLY_NOT_INSTALLED',source)
  self.assertIn('return 3',source)
  self.assertIn('G1_BACKUP_APPEND_ATTEMPT_START_SEPARATE_COMMIT',source)
  self.assertIn('G1_BACKUP_COMMIT_STATE_UNRESOLVED_READONLY_BACKUP_RECONCILE_REQUIRED_NO_MAPPING_ATTEMPT',source)
 def test_backup_baseline_dump_contract_reconcile_cleanup(self):
  source=(ROOT/'labs/taskflow/scripts/g1-workflow-operation.py').read_text()
  for marker in ['pg_get_constraintdef','pg_get_indexdef','backup trigger drift','backup rewrite drift','backup default drift','pg_export_snapshot','--snapshot=','--role=taskflow_migrator','PGOPTIONS','readonly-backup-reconcile','G1_BACKUP_ORIGIN','g1-backup-reference.json','G1_BACKUP_ORIGIN_COMMITTED_HASH_VERIFIED_NO_MAPPING_CLAIM']:
   self.assertIn(marker,source)
  workflow=(ROOT/'.github/workflows/taskflow-g1-executor-mapping.yml').read_text()
  for marker in ['rm -f --','test ! -e','G1_STOPPED_SENSITIVE_CLEANUP_FAILED','backup_origin']:
   self.assertIn(marker,workflow)
 def test_client_tls_guard_observes_correct_leg_and_fails_closed(self):
  from types import SimpleNamespace
  from unittest.mock import patch
  p=ROOT/'labs/taskflow/scripts/g1-workflow-operation.py'
  spec=importlib.util.spec_from_file_location('g1_tls_contract',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  ca=ROOT/'labs/taskflow/certs/supabase-prod-ca-2021.crt';pin=hashlib.sha256(ca.read_bytes()).hexdigest()
  for tls,mode,path,digest,ok in [(True,'verify-full',str(ca),pin,True),(False,'verify-full',str(ca),pin,False),(True,'require',str(ca),pin,False),(True,'verify-ca',str(ca),pin,False),(True,'verify-full','',pin,False),(True,'verify-full','/tmp/unreviewed.crt',pin,False),(True,'verify-full',str(ca),'0'*64,False)]:
   c=SimpleNamespace(info=SimpleNamespace(ssl_in_use=tls),get_dsn_parameters=lambda:{'sslmode':mode,'sslrootcert':path,'host':'aws-1-ap-northeast-2.pooler.supabase.com','port':'5432','dbname':'postgres','user':'taskflow_migrator.lenpbbhwxyyfwgvjcozf'})
   with patch.dict(os.environ,{'PIN_CA_SHA256':digest}):
    if ok:m.client_tls_guard(c)
    else:
     with self.assertRaises(ValueError):m.client_tls_guard(c)
  for key,value in [('host','other.supabase.com'),('port','6543'),('dbname','other'),('user','other'),('hostaddr','1.2.3.4'),('options','-c role=postgres')]:
   dsn={'sslmode':'verify-full','sslrootcert':str(ca),'host':'aws-1-ap-northeast-2.pooler.supabase.com','port':'5432','dbname':'postgres','user':'taskflow_migrator.lenpbbhwxyyfwgvjcozf'};dsn[key]=value
   c=SimpleNamespace(info=SimpleNamespace(ssl_in_use=True),get_dsn_parameters=lambda:dsn)
   with patch.dict(os.environ,{'PIN_CA_SHA256':pin}):
    with self.assertRaises(ValueError):m.client_tls_guard(c)
  source=p.read_text();self.assertNotIn('pg_stat_ssl WHERE',source);self.assertIn('try:client_tls_guard(c)',source)
 def test_reviewed_runner_refuses_wrong_hash_before_database(self):
  with tempfile.NamedTemporaryFile() as f:
   f.write(b'SELECT 1;');f.flush()
   r=subprocess.run(['python3',str(ROOT/'labs/taskflow/scripts/run-g1-reviewed-sql.py'),'--sql',f.name,'--sha256','0'*64],capture_output=True,text=True)
   self.assertEqual(r.returncode,2);self.assertIn('HASH_MISMATCH',r.stdout)
if __name__=='__main__':unittest.main()
