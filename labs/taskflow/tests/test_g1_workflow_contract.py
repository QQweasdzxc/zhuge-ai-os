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
  for marker in ['G1_STOPPED_COMMIT_UNKNOWN_READONLY_RECONCILE_REQUIRED','G1_STOPPED_POSTFLIGHT_FAILED_RETAIN','G1_READONLY_COMMITTED_EXACT','backup();preflight()','service=os.environ','c.set_session(readonly=readonly)','owner_only(q','gzip.decompress(base64.b64decode','c.commit()']:
   self.assertIn(marker,source)
 def test_reviewed_runner_refuses_wrong_hash_before_database(self):
  with tempfile.NamedTemporaryFile() as f:
   f.write(b'SELECT 1;');f.flush()
   r=subprocess.run(['python3',str(ROOT/'labs/taskflow/scripts/run-g1-reviewed-sql.py'),'--sql',f.name,'--sha256','0'*64],capture_output=True,text=True)
   self.assertEqual(r.returncode,2);self.assertIn('HASH_MISMATCH',r.stdout)
if __name__=='__main__':unittest.main()
