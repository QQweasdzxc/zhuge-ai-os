#!/usr/bin/env python3
"""Execute one hash-pinned, explicitly selected G1 SQL file non-interactively.
No credentials or DB coordinates are accepted here. Supply a libpq service via
PGSERVICE and PGSERVICEFILE. The production workflow remains SUSPENDED.
A nonzero exit, including deadline, is STOPPED. If COMMIT acknowledgement is
lost, do read-only reconciliation before any retry; never infer rollback.
"""
import argparse,hashlib,os,signal,subprocess,sys,time
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--sql',type=Path,required=True);p.add_argument('--sha256',required=True);a=p.parse_args()
 body=a.sql.read_bytes()
 if hashlib.sha256(body).hexdigest()!=a.sha256:
  print('G1_REFUSED_HASH_MISMATCH');return 2
 if not os.environ.get('PGSERVICE') or not os.environ.get('PGSERVICEFILE'):
  print('G1_REFUSED_SERVICE_REQUIRED');return 2
 # A separate process group ensures psql cannot wait on interactive children.
 # -w never prompts, -X ignores local psqlrc, ON_ERROR_STOP closes the
 # connection immediately on any error and PostgreSQL rolls open work back.
 start=time.monotonic()
 proc=subprocess.Popen(['psql','-X','-w','-q','-v','ON_ERROR_STOP=1','-f','-'],
  stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 try:
  proc.communicate(input=body,timeout=15)
  rc=proc.returncode
 except subprocess.TimeoutExpired:
  os.killpg(proc.pid,signal.SIGTERM)
  try:proc.wait(timeout=2)
  except subprocess.TimeoutExpired:
   os.killpg(proc.pid,signal.SIGKILL);proc.wait()
  print('G1_STOPPED_TOTAL_DEADLINE_COMMIT_STATE_REQUIRES_READBACK');return 124
 elapsed=time.monotonic()-start
 print(('G1_SQL_EXIT_OK' if rc==0 else 'G1_STOPPED_SQL_ERROR')+' elapsed_seconds=%.3f'%elapsed)
 return 0 if rc==0 else 1
if __name__=='__main__':sys.exit(main())
